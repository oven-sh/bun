//! Implements [`Js`] on top of the JavaScript parser. It plays the role that acorn plays for Svelte's own parser.

use super::ast::{Expression, ExpressionKind, Span};
use super::parser::{Js, ParsedExpression, ReadFor, Statement};
use crate::html::js::Parse;
use crate::options::{Goal, ParsePart, Part};
use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::ast::{
    BinOp, Expr, ExprKind, ExprTag, File, Flags, FnBody, Node, PropKind, Stmt, StmtKind, VarKind,
};

pub(crate) struct FromParser<'p> {
    /// Parses a program.
    pub(crate) parse: Parse<'p>,
    /// Parses the code at a given offset in the component.
    pub(crate) parse_part: ParsePart<'p>,
    pub(crate) is_typescript: bool,
    /// Parsing a part ran out of stack.
    pub(crate) is_nested_too_deeply: bool,
    /// The last error, if it's TypeScript-only syntax in JavaScript: the offset where acorn stops, and where that
    /// syntax starts.
    pub(crate) typescript_at: Option<(usize, usize)>,
    /// Offset of the last error, if it's the `=` of an object's shorthand property: `{ a = 1 }`.
    pub(crate) shorthand_at: Option<usize>,
    /// Offset where the last expression was cut off before an `as`, a `satisfies` or a `!`.
    pub(crate) stopped_at: Option<usize>,
    pub(crate) read_for: ReadFor,
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

/// Describes `e`, which was parsed from text that starts at offset `at` in the component.
fn describe<'b>(file: &'b File<'b>, e: Expr<'b>, at: u32, read_for: ReadFor) -> Expression {
    let span = e.span();
    // Svelte attaches the comments before a parenthesis to the `ParenthesizedExpression`, which it drops.
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
        has_type_info: read_for == ReadFor::Linting && has_type_info(e),
        ..Expression::new(span, kind_of(e))
    }
}

/// svelte-eslint-parser's `hasTypeInfo`: an assertion, a literal, a function whose parameters and return are typed, and
/// expressions built from those. A loop over what's left to inspect, because the expression can nest to any depth.
fn has_type_info(e: Expr<'_>) -> bool {
    let mut pending: smallvec::SmallVec<[Expr<'_>; 8]> = smallvec::smallvec![e];
    while let Some(e) = pending.pop() {
        let typed = match e.kind() {
            ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
            | ExprKind::Template(_)
            | ExprKind::Unary { .. } => true,
            ExprKind::Fn(function) => {
                let params = function.params_with_this().all(|it| {
                    let is_property = it.flags().contains(Flags::PARAMETER_PROPERTY);
                    is_property || (it.default().is_none() && it.ty().is_some())
                });
                match (params, function.return_type(), function.body()) {
                    (false, ..) => false,
                    (true, Some(_), _) => true,
                    (true, None, FnBody::Expr(body)) => {
                        pending.push(body);
                        true
                    }
                    (true, None, _) => false,
                }
            }
            ExprKind::Object(props) => {
                for prop in props.iter() {
                    match prop.value() {
                        Some(value) if prop.kind() != PropKind::Shorthand => pending.push(value),
                        _ => return false,
                    }
                }
                true
            }
            ExprKind::Array(elements) => {
                pending.extend(elements.iter().filter(|it| it.tag() != ExprTag::Missing));
                true
            }
            ExprKind::Spread(argument) => {
                pending.push(argument);
                true
            }
            ExprKind::Cond { yes, no, .. } => {
                pending.extend([yes, no]);
                true
            }
            ExprKind::Assign { value, .. } => {
                pending.push(value);
                true
            }
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => {
                pending.push(right);
                true
            }
            _ => false,
        };
        if !typed {
            return false;
        }
    }
    true
}

/// Finds the outermost `a as T` that ends where `e` ends. Returns the end of `a` and the start of `T`.
fn assertion_at_end(e: Expr<'_>) -> Option<(u32, u32)> {
    let end = e.span().end;
    let mut at = e;
    loop {
        // Only a node's last child can end where the node ends.
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

/// In JavaScript: where acorn stops at the first TypeScript-only syntax, and where that syntax starts.
fn typescript_in<'a>(file: &'a File<'a>) -> Option<(u32, u32)> {
    let starts = file.first_typescript_syntax_in_javascript()?;
    let stops = bun_lint::linter::acorn_stops_at_typescript(file).unwrap_or(starts);
    Some((stops, starts))
}

/// Finds the errors that acorn reports and TypeScript's parser leaves to the checker.
struct EarlyErrors<'a> {
    text: &'a [u8],
    is_typescript: bool,
    /// Number of non-arrow functions and classes that enclose the current node.
    depth: u32,
    first_error: Option<u32>,
    /// True if the first error is a shorthand property's `=`.
    is_shorthand: bool,
    /// In JavaScript, the offset of the first TypeScript `as`, `satisfies` or `!`. acorn stops before it.
    first_typescript_operator: Option<u32>,
    /// In JavaScript, the offset of the first `<T>a`, which the parser doesn't report.
    first_assertion: Option<u32>,
}

/// 1 for a non-arrow function or a class, otherwise 0.
fn scopes_of(node: Node<'_>) -> u32 {
    match node {
        Node::Func(function) => u32::from(!function.is_arrow()),
        Node::Class(_) => 1,
        _ => 0,
    }
}

impl<'a> Visitor<'a> for EarlyErrors<'a> {
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
            // "Shorthand property assignments are valid only in destructuring patterns", at the `=` of `{ a = 1 }`.
            ExprKind::Object(props) if !e.is_assignment_target() => props.iter().find_map(|it| {
                let ExprKind::Assign { target, .. } = it.value()?.kind() else {
                    return None;
                };
                let equals = bun_lint::tokens::skip_trivia(self.text, target.span().end);
                (it.kind() == PropKind::Shorthand).then_some(equals)
            }),
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
                if !self.is_typescript && self.first_typescript_operator.is_none_or(|it| end < it) {
                    self.first_typescript_operator = Some(end);
                }
                None
            }
            _ => None,
        };
        if let Some(error) = error
            && self.first_error.is_none()
        {
            self.first_error = Some(error);
            self.is_shorthand = matches!(e.kind(), ExprKind::Object(_));
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

    /// Parses the code at `at` and calls `read` with its only statement and its end offset. `until` is where the
    /// parser must treat the component as ending.
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
            let mut shorthand_at = None;
            let parsed = (self.parse_part)(part, &mut |file, end| {
                let mut early = EarlyErrors {
                    text: file.text(),
                    is_typescript,
                    depth: 0,
                    first_error: None,
                    is_shorthand: false,
                    first_typescript_operator: None,
                    first_assertion: None,
                };
                walk(file, &mut early);
                stops_at = early.first_typescript_operator;
                // acorn doesn't support any TypeScript syntax.
                typescript_at = (typescript_in(file).into_iter())
                    .chain(early.first_assertion.map(|it| (it, it)))
                    .min_by_key(|it| it.1)
                    .filter(|(_, it)| {
                        !is_typescript && early.first_error.is_none_or(|error| *it < error)
                    })
                    .map(|(stops, it)| (at + stops as usize, at + it as usize));
                shorthand_at = (early.first_error)
                    .filter(|_| early.is_shorthand)
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
            // Retry with the text cut off before the TypeScript operator.
            match (stops_at, typescript_at) {
                (Some(it), _) => {
                    until = at + it as usize;
                    self.stopped_at = Some(until);
                }
                (None, Some(it)) => {
                    self.typescript_at = Some(it);
                    return Err(it.0);
                }
                (None, None) => {
                    self.shorthand_at =
                        shorthand_at.filter(|it| matches!(result, Err(error) if error == *it));
                    return result;
                }
            }
        }
    }

    /// Parses `program` and calls `read` with its first statement. `at` is the offset in the component of `program`'s
    /// second byte.
    fn program<R>(
        &mut self,
        (program, at): (&[u8], u32),
        read: impl for<'b> Fn(&'b File<'b>, StmtKind<'b>) -> Option<R>,
    ) -> Result<R, usize> {
        let (mut result, mut typescript_at) = (None, None);
        self.parse.call(self.path(), program, false, &mut |file| {
            typescript_at = typescript_in(file);
            if !file.has_parse_errors() && typescript_at.is_none() {
                result = (file.body().iter().next()).and_then(|it| read(file, it.kind()));
            }
        });
        let in_component = |it: u32| (at + it) as usize - 1;
        self.typescript_at =
            typescript_at.map(|(stops, it)| (in_component(stops), in_component(it)));
        result.ok_or_else(|| self.typescript_at.map_or(at as usize, |it| it.0))
    }
}

impl Js for FromParser<'_> {
    fn start(&mut self, is_typescript: bool) {
        self.is_typescript = is_typescript;
    }

    fn expression_at(&mut self, text: &[u8], at: usize) -> Result<ParsedExpression, usize> {
        let read_for = self.read_for;
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
                    expression: describe(file, e, at, read_for),
                    end,
                    first: first.map(|it| describe(file, it, at, read_for)),
                    assertion: assertion.map(|it| (at + it.0, at + it.1)),
                })
            },
        )
    }

    fn ends_of_expressions(&mut self, text: &[u8], at: usize, until: usize) -> Vec<usize> {
        // Parse it as the right side of a `=`, where a `{` starts an object. The parser recovers from whatever is
        // missing at the end.
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
        // `type` can be an identifier.
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
