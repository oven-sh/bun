//! [`Js`] on the parser of JavaScript: what acorn is to Svelte's own parser.

use super::ast::{Expression, ExpressionKind, Span};
use super::parser::{Js, ParsedExpression, Statement};
use crate::html::js::Parse;
use crate::options::{Code, Goal};
use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::ast::{BinOp, Expr, ExprKind, File, FnBody, Node, Stmt, StmtKind, VarKind};

pub(crate) struct FromParser<'p> {
    pub(crate) parse: Parse<'p>,
    pub(crate) is_typescript: bool,
}

fn kind_of(e: Expr<'_>) -> ExpressionKind {
    match e.kind() {
        ExprKind::Ident(_) => ExpressionKind::Identifier,
        ExprKind::String(_) => ExpressionKind::StringLiteral,
        ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_) => ExpressionKind::OtherLiteral,
        ExprKind::Binary {
            op: BinOp::Comma, ..
        } => ExpressionKind::Sequence,
        ExprKind::Call(_) => ExpressionKind::Call,
        ExprKind::Object(_) => ExpressionKind::Object,
        _ => ExpressionKind::Other,
    }
}

/// `e`, which is in a text that starts at `at`.
fn describe<'b>(file: &'b File<'b>, e: Expr<'b>, at: u32) -> Expression {
    let span = e.span();
    // Svelte gives the comments before a parenthesis to the `ParenthesizedExpression`, which it drops.
    let after = e.parens().next().map_or(0, |innermost| innermost.start + 1);
    let from = (file.comments().into_iter().map(|it| it.span()))
        .find(|it| it.start >= after && it.end <= span.start)
        .map_or(span.start, |it| it.start);
    Expression {
        span: Span {
            start: at + span.start,
            end: at + span.end,
        },
        kind: kind_of(e),
        from: at + from,
    }
}

/// The outermost `a as T` that ends where `e` ends: where `a` ends, and where `T` starts.
fn assertion_at_end(e: Expr<'_>) -> Option<(u32, u32)> {
    let end = e.span().end;
    let mut at = e;
    loop {
        // What ends where this ends is the last thing in it.
        at = match at.kind() {
            ExprKind::As { expr, .. } if at.is_angle_bracket_assertion() => expr,
            ExprKind::As { expr, ty } => return Some((expr.outer_span().end, ty.span().start)),
            ExprKind::Binary { right, .. } => right,
            ExprKind::Assign { value, .. } => value,
            ExprKind::Cond { no, .. } => no,
            ExprKind::Unary { operand, .. }
            | ExprKind::Await(operand)
            | ExprKind::Spread(operand) => operand,
            ExprKind::Yield {
                value: Some(value), ..
            } => value,
            ExprKind::Fn(function) => match function.body() {
                FnBody::Expr(body) => body,
                _ => return None,
            },
            _ => return None,
        };
        if at.span().end != end {
            return None;
        }
    }
}

/// Finds what acorn refuses and the parser of TypeScript leaves to the checker.
struct Early {
    is_typescript: bool,
    /// How many functions that are no arrow functions, and classes, are around what is visited.
    depth: u32,
    first_error: Option<u32>,
    /// In JavaScript: where the first `as`, `satisfies` or `!` of TypeScript is. acorn stops before it.
    first_of_typescript: Option<u32>,
}

/// 1 for a function that is no arrow function, and for a class.
fn scopes_of(node: Node<'_>) -> u32 {
    match node {
        Node::Func(function) => u32::from(!function.is_arrow()),
        Node::Class(_) => 1,
        _ => 0,
    }
}

impl<'a> Visitor<'a> for Early {
    fn enter(&mut self, node: Node<'a>) {
        self.depth += scopes_of(node);
        let Node::Expr(e) = node else {
            return;
        };
        let error = match e.kind() {
            // "Assigning to rvalue"
            ExprKind::Assign { target, .. } => matches!(
                target.kind(),
                ExprKind::Number(_)
                    | ExprKind::String(_)
                    | ExprKind::BigInt(_)
                    | ExprKind::Regex(_)
                    | ExprKind::Template(_)
                    | ExprKind::Null
                    | ExprKind::True
                    | ExprKind::False
                    | ExprKind::This
                    | ExprKind::Call(_)
                    | ExprKind::Binary { .. }
                    | ExprKind::Unary { .. }
                    | ExprKind::Cond { .. }
                    | ExprKind::Fn(_)
            )
            .then(|| target.span().start),
            ExprKind::Yield { .. } | ExprKind::Super | ExprKind::PrivateIdentifier(_) => {
                (self.depth == 0).then(|| e.span().start)
            }
            // "The keyword 'yield' is reserved"
            ExprKind::Ident(_) => (e.text() == b"yield").then(|| e.span().start),
            ExprKind::Fn(function) => (!self.is_typescript
                && function.type_params().iter().next().is_some())
            .then(|| e.span().start),
            ExprKind::As { .. } if e.is_angle_bracket_assertion() => {
                (!self.is_typescript).then(|| e.span().start)
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) => {
                let end = expr.outer_span().end;
                if !self.is_typescript && self.first_of_typescript.is_none_or(|it| end < it) {
                    self.first_of_typescript = Some(end);
                }
                None
            }
            _ => None,
        };
        if let Some(error) = error {
            self.first_error.get_or_insert(error);
        }
    }

    fn exit(&mut self, node: Node<'a>) {
        self.depth -= scopes_of(node);
    }
}

impl FromParser<'_> {
    fn path(&self) -> &'static [u8] {
        match self.is_typescript {
            true => b"dummy.ts",
            false => b"dummy.js",
        }
    }

    /// What `read` makes of the only statement of what `text` has at `at`, and of where that ends.
    fn part<R>(
        &self,
        (text, at): (&[u8], usize),
        goal: Goal,
        read: impl for<'b> Fn(&'b File<'b>, Stmt<'b>, u32) -> Option<R>,
    ) -> Result<R, usize> {
        let code = Code {
            path: match goal {
                Goal::Type => b"dummy.ts",
                _ => self.path(),
            },
            text: text.get(at..).unwrap_or_default(),
            is_script: false,
            goal,
        };
        let (mut result, mut stops_at) = (Err(at), None);
        self.parse.call_for(code, &mut |parsed| {
            let statement = parsed.file.body().iter().next();
            let mut early = Early {
                is_typescript: self.is_typescript || goal == Goal::Type,
                depth: 0,
                first_error: None,
                first_of_typescript: None,
            };
            if parsed.first_error.is_none() {
                walk(parsed.file, &mut early);
            }
            stops_at = early.first_of_typescript;
            result = match (parsed.first_error.or(early.first_error), statement) {
                (Some(error), _) => Err(at + error as usize),
                (None, None) => Err(at),
                (None, Some(statement)) => {
                    read(parsed.file, statement, at as u32 + parsed.end).ok_or(at)
                }
            };
        });
        // Once more, with nothing to see of it.
        match stops_at.and_then(|it| text.get(..at + it as usize)) {
            Some(text) => self.part((text, at), goal, read),
            None => result,
        }
    }

    /// What `read` makes of `program`.
    fn program<R>(
        &self,
        program: &[u8],
        read: impl for<'b> Fn(StmtKind<'b>) -> Option<R>,
    ) -> Option<R> {
        let mut result = None;
        self.parse.call(self.path(), program, false, &mut |file| {
            if !file.has_parse_errors() {
                result = file.body().iter().next().and_then(|it| read(it.kind()));
            }
        });
        result
    }
}

impl Js for FromParser<'_> {
    fn start(&mut self, is_typescript: bool) {
        self.is_typescript = is_typescript;
    }

    fn expression_at(&mut self, text: &[u8], at: usize) -> Result<ParsedExpression, usize> {
        self.part((text, at), Goal::Expression, |file, statement, end| {
            let StmtKind::Expr(e) = statement.kind() else {
                return None;
            };
            let first = (kind_of(e) == ExpressionKind::Sequence)
                .then(|| e.sequence().first().copied())
                .flatten();
            let at = at as u32;
            Some(ParsedExpression {
                expression: describe(file, e, at),
                end,
                first: first.map(|it| describe(file, it, at)),
                assertion: assertion_at_end(first.unwrap_or(e)).map(|it| (at + it.0, at + it.1)),
            })
        })
    }

    fn statement_at(&mut self, text: &[u8], at: usize) -> Result<Statement, usize> {
        // `type` can be a name.
        if text.get(at..).is_some_and(|it| it.starts_with(b"type")) {
            return Ok(match self.expression_at(text, at) {
                Ok(_) => Statement::Expression,
                Err(_) => Statement::Other,
            });
        }
        self.part((text, at), Goal::Declaration, |_, statement, end| {
            let StmtKind::Var(declarations) = statement.kind() else {
                return Some(Statement::Other);
            };
            Some(match declarations.iter().next().map(|it| it.var_kind()) {
                Some(VarKind::Let | VarKind::Const) => Statement::Declaration(end),
                _ => Statement::OtherDeclaration,
            })
        })
    }

    fn type_at(&mut self, text: &[u8], at: usize) -> Result<Span, usize> {
        self.part((text, at), Goal::Type, |_, statement, _| {
            match statement.kind() {
                StmtKind::TypeAlias(alias) => {
                    let span = alias.ty().span();
                    Some(Span::new(at + span.start as usize, at + span.end as usize))
                }
                _ => None,
            }
        })
    }

    fn check_pattern(&mut self, text: &[u8], pattern: Span) -> Result<(), usize> {
        let program = [b"(", pattern.of(text), b" = 1\n)"].concat();
        self.program(&program, |_| Some(()))
            .ok_or(pattern.start as usize)
    }

    fn parameters(&mut self, text: &[u8], parameters: Span) -> Result<Option<u32>, usize> {
        let program = [b"(", parameters.of(text), b" => {}\n)"].concat();
        self.program(&program, |statement| match statement {
            StmtKind::Expr(e) => match e.kind() {
                // One byte, the `(`, is before them.
                ExprKind::Fn(function) => Some(
                    (function.params().iter().last())
                        .map(|it| parameters.start + it.span_without_modifiers().end - 1),
                ),
                _ => None,
            },
            _ => None,
        })
        .ok_or(parameters.start as usize)
    }
}
