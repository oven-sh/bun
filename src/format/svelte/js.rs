//! [`Js`] on the parser of JavaScript: what acorn is to Svelte's own parser.

use super::ast::{Expression, ExpressionKind, Span};
use super::parser::{Js, ParsedExpression, Statement};
use crate::html::js::Parse;
use crate::options::{Goal, ParsePart, Part};
use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::ast::{BinOp, Expr, ExprKind, File, FnBody, Node, Stmt, StmtKind, VarKind};

pub(crate) struct FromParser<'p> {
    /// Parses a program.
    pub(crate) parse: Parse<'p>,
    /// Parses what the component has at some place.
    pub(crate) parse_part: ParsePart<'p>,
    pub(crate) is_typescript: bool,
    /// The stack has ended in a part.
    pub(crate) is_nested_too_deeply: bool,
    /// Where the last error is, if it is that only TypeScript has what is there.
    pub(crate) typescript_at: Option<usize>,
    /// Where the last expression has been ended before an `as`, a `satisfies` or a `!`.
    pub(crate) stopped_at: Option<usize>,
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
    let span = Span {
        start: at + span.start,
        end: at + span.end,
    };
    Expression {
        from: at + from,
        ..Expression::new(span, kind_of(e))
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
    /// In JavaScript: where the first `<T>a` is, about which the parser says nothing.
    first_assertion: Option<u32>,
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
            ExprKind::As { .. } | ExprKind::AsConst(_) if e.is_angle_bracket_assertion() => {
                let start = e.span().start;
                if !self.is_typescript && self.first_assertion.is_none_or(|it| start < it) {
                    self.first_assertion = Some(start);
                }
                None
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

    /// What `read` makes of the only statement of what the component has at `at`, and of where that ends. `until`: where the
    /// component ends for the parser.
    fn part<R>(
        &mut self,
        (mut until, at): (usize, usize),
        goal: Goal,
        read: impl for<'b> Fn(&'b File<'b>, Stmt<'b>, u32) -> Option<R>,
    ) -> Result<R, usize> {
        let is_typescript = self.is_typescript || goal == Goal::Type;
        loop {
            let part = Part {
                goal,
                from: at as u32,
                until: until as u32,
                is_typescript,
            };
            let (mut result, mut stops_at, mut typescript_at) = (Err(at), None, None);
            let parsed = (self.parse_part)(part, &mut |file, end| {
                let mut early = Early {
                    is_typescript,
                    depth: 0,
                    first_error: None,
                    first_of_typescript: None,
                    first_assertion: None,
                };
                walk(file, &mut early);
                stops_at = early.first_of_typescript;
                // acorn knows none of it.
                typescript_at = (file.first_of_typescript_in_javascript().into_iter())
                    .chain(early.first_assertion)
                    .min()
                    .filter(|it| {
                        !is_typescript && early.first_error.is_none_or(|error| *it < error)
                    })
                    .map(|it| at + it as usize);
                result = match (early.first_error, file.body().iter().next()) {
                    (Some(error), _) => Err(at + error as usize),
                    (None, None) => Err(at),
                    (None, Some(statement)) => read(file, statement, at as u32 + end).ok_or(at),
                };
            });
            if let Err(error) = parsed {
                self.is_nested_too_deeply |= error.is_nested_too_deeply;
                return Err(error.at as usize);
            }
            // Once more, with nothing to see of it.
            match (stops_at, typescript_at) {
                (Some(it), _) => {
                    until = at + it as usize;
                    self.stopped_at = Some(until);
                }
                (None, Some(it)) => {
                    self.typescript_at = Some(it);
                    return Err(it);
                }
                (None, None) => return result,
            }
        }
    }

    /// What `read` makes of `program`.
    /// `at`: where the second byte of `program` is in the component.
    fn program<R>(
        &mut self,
        (program, at): (&[u8], u32),
        read: impl for<'b> Fn(&'b File<'b>, StmtKind<'b>) -> Option<R>,
    ) -> Result<R, usize> {
        let (mut result, mut typescript_at) = (None, None);
        self.parse.call(self.path(), program, false, &mut |file| {
            typescript_at = file.first_of_typescript_in_javascript();
            if !file.has_parse_errors() && typescript_at.is_none() {
                result = (file.body().iter().next()).and_then(|it| read(file, it.kind()));
            }
        });
        self.typescript_at = typescript_at.map(|it| (at + it) as usize - 1);
        result.ok_or_else(|| self.typescript_at.unwrap_or(at as usize))
    }
}

impl Js for FromParser<'_> {
    fn start(&mut self, is_typescript: bool) {
        self.is_typescript = is_typescript;
    }

    fn expression_at(&mut self, text: &[u8], at: usize) -> Result<ParsedExpression, usize> {
        self.part(
            (text.len(), at),
            Goal::Expression,
            |file, statement, end| {
                let StmtKind::Expr(e) = statement.kind() else {
                    return None;
                };
                let first = (kind_of(e) == ExpressionKind::Sequence)
                    .then(|| e.sequence().first().copied())
                    .flatten();
                let at = at as u32;
                let assertion = assertion_at_end(first.unwrap_or(e));
                Some(ParsedExpression {
                    expression: describe(file, e, at),
                    end,
                    first: first.map(|it| describe(file, it, at)),
                    assertion: assertion.map(|it| (at + it.0, at + it.1)),
                })
            },
        )
    }

    fn ends_of_expressions(&mut self, text: &[u8], at: usize, until: usize) -> Vec<usize> {
        // On the right of a `=`, where a `{` starts an object. What is missing at the end is made up.
        const BEFORE: &[u8] = b"_=";
        let program = [BEFORE, text.get(at..until).unwrap_or_default()].concat();
        let mut ends = Vec::new();
        self.parse.call(self.path(), &program, false, &mut |file| {
            let Some(StmtKind::Expr(whole)) = file.body().iter().next().map(|it| it.kind()) else {
                return;
            };
            let mut open = vec![whole];
            while let Some(e) = open.pop() {
                if let Some(end) = (e.outer_span().end as usize).checked_sub(BEFORE.len()) {
                    ends.push(at + end);
                }
                if e.is_parenthesized() {
                    continue;
                }
                match e.kind() {
                    ExprKind::Binary { left, right, .. } => open.extend([left, right]),
                    ExprKind::Assign { target, value, .. } => open.extend([target, value]),
                    ExprKind::Cond { test, no, .. } => open.extend([test, no]),
                    ExprKind::Unary { operand: it, .. }
                    | ExprKind::Await(it)
                    | ExprKind::Spread(it)
                    | ExprKind::NonNull(it)
                    | ExprKind::AsConst(it)
                    | ExprKind::Yield {
                        value: Some(it), ..
                    }
                    | ExprKind::Dot { obj: it, .. }
                    | ExprKind::Index { obj: it, .. }
                    | ExprKind::As { expr: it, .. }
                    | ExprKind::Satisfies { expr: it, .. }
                    | ExprKind::Instantiation { expr: it, .. } => open.push(it),
                    ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                        open.push(call.callee());
                    }
                    ExprKind::Fn(function) => {
                        if let FnBody::Expr(body) = function.body() {
                            open.push(body);
                        }
                    }
                    _ => {}
                }
            }
        });
        ends
    }

    fn statement_at(&mut self, text: &[u8], at: usize) -> Result<Statement, usize> {
        // `type` can be a name.
        if text.get(at..).is_some_and(|it| it.starts_with(b"type")) {
            return Ok(match self.expression_at(text, at) {
                Ok(_) => Statement::Expression,
                Err(_) => Statement::Other,
            });
        }
        self.part((text.len(), at), Goal::Declaration, |_, statement, end| {
            let StmtKind::Var(declarations) = statement.kind() else {
                return Some(Statement::Other);
            };
            Some(match declarations.iter().next().map(|it| it.var_kind()) {
                Some(VarKind::Let | VarKind::Const) => Statement::Declaration(end),
                _ => Statement::OtherDeclaration,
            })
        })
    }

    fn type_at(&mut self, text: &[u8], at: usize) -> Result<(Span, bool), usize> {
        self.part(
            (text.len(), at),
            Goal::Type,
            |file, statement, _| match statement.kind() {
                StmtKind::TypeAlias(alias) => {
                    let span = alias.ty().span();
                    let span = Span::new(at + span.start as usize, at + span.end as usize);
                    Some((span, file.comments().next().is_some()))
                }
                _ => None,
            },
        )
    }

    fn check_pattern(&mut self, text: &[u8], pattern: Span) -> Result<bool, usize> {
        let program = [b"(", pattern.of(text), b" = 1\n)"].concat();
        self.program((&program, pattern.start), |file, _| {
            Some(file.comments().next().is_some())
        })
    }

    fn check_parameters(&mut self, text: &[u8], parameters: Span) -> Result<(), usize> {
        let program = [b"(", parameters.of(text), b" => {}\n)"].concat();
        self.program(
            (&program, parameters.start),
            |_, statement| match statement {
                StmtKind::Expr(e) if matches!(e.kind(), ExprKind::Fn(_)) => Some(()),
                _ => None,
            },
        )
    }
}
