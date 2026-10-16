//! Assignment targets, checked the way oxc's parser checks them.
//!
//! oxc parses the left side as an expression and converts it once it reaches the operator (`CoverGrammar` in its source). Most
//! failures are fatal: the parser stops there, so nothing after them is reported.

use super::{Stage, SyntaxError};
use crate::ast::{
    Chain, Expr, ExprKind, ExprTag, File, List, Node, Prop, PropKind, StmtKind, StmtTag, UnOp,
};
use crate::span::Span;
use crate::tokens::skip_trivia;
use bun_sema::hir::{self, rare};
use std::borrow::Cow;

#[derive(Copy, Clone)]
enum Problem {
    CannotAssign,
    Instantiation,
    PatternWithOperator,
    DefaultWithOperator,
    BadRest,
    RestNotLast,
    CommaAfterRest,
    Unexpected,
}

impl Problem {
    fn message(self) -> &'static str {
        match self {
            Problem::CannotAssign => "Cannot assign to this expression",
            Problem::Instantiation => {
                "The left-hand side of an assignment expression must be a variable or a property access."
            }
            Problem::PatternWithOperator => "Invalid left-hand side in assignment",
            Problem::DefaultWithOperator => {
                "Only '=' operator can be used for specifying default value."
            }
            Problem::BadRest => "Invalid rest element target in destructuring assignment",
            Problem::RestNotLast => "Spread must be last element",
            Problem::CommaAfterRest => {
                "A rest parameter or binding pattern may not have a trailing comma."
            }
            Problem::Unexpected => "Unexpected token",
        }
    }

    fn help(self) -> &'static str {
        match self {
            Problem::DefaultWithOperator => "Replace this operator with `=`.",
            Problem::BadRest => {
                "Expected an identifier or member expression, like `...rest` or `...obj.prop`."
            }
            Problem::CommaAfterRest => "Remove the trailing comma here",
            _ => "",
        }
    }
}

struct Found {
    /// How far oxc has read when it reports the error.
    noticed: u32,
    is_fatal: bool,
    label: Span,
    problem: Problem,
}

struct Targets<'a> {
    file: &'a File<'a>,
    found: Vec<Found>,
    /// `Found::noticed` of what is being converted.
    noticed: u32,
}

fn is_update(op: UnOp) -> bool {
    matches!(
        op,
        UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
    )
}

/// oxc's `get_inner_expression`
fn innermost(mut it: Expr) -> Expr {
    loop {
        it = match it.kind() {
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::Instantiation { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) => expr,
            _ => return it,
        };
    }
}

fn is_name_or_member(it: Expr) -> bool {
    match it.tag() {
        ExprTag::Ident => true,
        ExprTag::Dot | ExprTag::Index => it.chain() == Chain::No,
        _ => false,
    }
}

impl<'a> Targets<'a> {
    fn report(&mut self, label: Span, problem: Problem) {
        self.found.push(Found {
            noticed: self.noticed,
            is_fatal: false,
            label,
            problem,
        });
    }

    /// Returns `false`, which every conversion hands up: nothing more is converted.
    fn stop(&mut self, label: Span, problem: Problem) -> bool {
        self.found.push(Found {
            noticed: self.noticed,
            is_fatal: true,
            label,
            problem,
        });
        false
    }

    /// `AssignmentTarget::cover`
    fn target(&mut self, it: Expr<'a>) -> bool {
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return true;
        }
        match it.kind() {
            ExprKind::Array(elements) if !it.is_parenthesized() => self.array(elements),
            ExprKind::Object(props) if !it.is_parenthesized() => self.object(props),
            _ => self.simple(it),
        }
    }

    /// `SimpleAssignmentTarget::cover`
    fn simple(&mut self, it: Expr<'a>) -> bool {
        match it.kind() {
            ExprKind::Array(_) | ExprKind::Object(_) if it.is_parenthesized() => {
                let parentheses = it.parens().next().unwrap_or_else(|| it.span());
                self.stop(parentheses, Problem::CannotAssign)
            }
            _ if is_name_or_member(it) => true,
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
                if is_name_or_member(innermost(expr)) =>
            {
                true
            }
            ExprKind::Instantiation { .. } => self.stop(it.span(), Problem::Instantiation),
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec,
                ..
            } if !it.is_parenthesized() => {
                // It starts the span of `++a` in `++ ++a` at the first `++`.
                let mut first = it;
                while let Node::Expr(parent) = first.parent()
                    && matches!(parent.as_unary(), Some((UnOp::PreInc | UnOp::PreDec, _)))
                    && !first.is_parenthesized()
                {
                    first = parent;
                }
                self.stop(
                    Span::new(first.span().start, it.span().end),
                    Problem::CannotAssign,
                )
            }
            _ => self.stop(it.span(), Problem::CannotAssign),
        }
    }

    /// `AssignmentTargetMaybeDefault::cover`
    fn maybe_default(&mut self, it: Expr<'a>) -> bool {
        match it.as_assign() {
            // Its left side was converted when the parser got to its operator.
            Some((op, ..)) if !it.is_parenthesized() => {
                if op.is_some() {
                    self.report(it.span(), Problem::DefaultWithOperator);
                }
                true
            }
            _ => self.target(it),
        }
    }

    fn comma_after_rest(&mut self, rest_end: u32) {
        let at = skip_trivia(self.file.text(), rest_end);
        if self.file.text().get(at as usize) == Some(&b',') {
            self.report(Span::new(at, at + 1), Problem::CommaAfterRest);
        }
    }

    /// `ArrayAssignmentTarget::cover`
    fn array(&mut self, elements: List<'a, Expr<'a>>) -> bool {
        let last = elements.len().wrapping_sub(1);
        for (i, element) in elements.iter().enumerate() {
            let goes_on = match element.kind() {
                ExprKind::Missing => true,
                ExprKind::Spread(_) if i != last => self.stop(element.span(), Problem::RestNotLast),
                ExprKind::Spread(argument) => {
                    let inner = innermost(argument);
                    if !is_name_or_member(inner)
                        && !matches!(inner.tag(), ExprTag::Array | ExprTag::Object)
                    {
                        self.report(argument.outer_span(), Problem::BadRest);
                    }
                    let goes_on = self.target(argument);
                    if goes_on {
                        self.comma_after_rest(element.span().end);
                    }
                    goes_on
                }
                _ => self.maybe_default(element),
            };
            if !goes_on {
                return false;
            }
        }
        true
    }

    /// `ObjectAssignmentTarget::cover`
    fn object(&mut self, props: List<'a, Prop<'a>>) -> bool {
        let last = props.len().wrapping_sub(1);
        for (i, prop) in props.iter().enumerate() {
            let goes_on = match (prop.kind(), prop.value()) {
                (PropKind::Spread, _) if i != last => self.stop(prop.span(), Problem::RestNotLast),
                (PropKind::Spread, Some(argument)) => {
                    if !is_name_or_member(innermost(argument)) {
                        self.report(argument.outer_span(), Problem::BadRest);
                    }
                    self.comma_after_rest(prop.span().end);
                    self.target(argument)
                }
                (PropKind::Init, Some(value)) => self.maybe_default(value),
                (PropKind::Method | PropKind::Getter | PropKind::Setter, _) => {
                    let function = prop.func().map(|it| it.span_from_params());
                    self.stop(
                        function.unwrap_or_else(|| prop.span()),
                        Problem::CannotAssign,
                    )
                }
                _ => true,
            };
            if !goes_on {
                return false;
            }
        }
        true
    }
}

/// What oxc reports about the targets of assignments, of `++` and `--`, and of `for-in` and `for-of`.
pub(super) fn errors<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(rare::ODD_TARGET) {
        return Vec::new();
    }
    let mut targets = Targets {
        file,
        found: Vec::new(),
        noticed: 0,
    };
    // Not by kind: nothing else may want the expressions of the file sorted.
    for (i, raw) in file.hir.exprs.iter().enumerate() {
        let (is_assignment, target) = match raw.kind {
            hir::ExprKind::Assign { target, .. } => (true, target),
            hir::ExprKind::Unary { op, operand } if is_update(op) => (false, operand),
            _ => continue,
        };
        let target = Expr::new(file, target);
        if is_name_or_member(target) || file.expr_in_tree(i).is_none() {
            continue;
        }
        targets.noticed = target.outer_span().end;
        if !is_assignment {
            targets.simple(target);
            continue;
        }
        let has_operator = matches!(raw.kind, hir::ExprKind::Assign { op: Some(_), .. });
        if has_operator
            && matches!(target.tag(), ExprTag::Array | ExprTag::Object)
            && !target.is_parenthesized()
        {
            targets.report(target.span(), Problem::PatternWithOperator);
        }
        targets.target(target);
    }
    for tag in [StmtTag::ForIn, StmtTag::ForOf] {
        for it in file.stmts_of_kind(tag) {
            if let StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } = it.kind()
                && let StmtKind::Expr(target) = left.kind()
                && !is_name_or_member(target)
            {
                targets.noticed = target.outer_span().end;
                // oxc looks for the operand of a `yield` wherever the line goes on, and finds the `in`.
                let is_yield = matches!(target.kind(), ExprKind::Yield { value: None, .. });
                let keyword = skip_trivia(file.text(), target.span().end);
                let between = file.slice(Span::after(target.span(), keyword));
                if is_yield
                    && tag == StmtTag::ForIn
                    && !target.is_parenthesized()
                    && !bun_core::strings::contains_js_line_break(between)
                {
                    targets.noticed = keyword;
                    targets.stop(Span::new(keyword, keyword + 2), Problem::Unexpected);
                    continue;
                }
                targets.target(target);
            }
        }
    }
    // oxc converts a target when it has read the operator after it. Where TypeScript's parser has an error up to there, the
    // tree has a hole, and oxc's parser has given up at that error.
    let gives_up_at = super::super::error_of_parser(file).map(|it| it.map_or(0, |it| it.start));
    (targets.found.into_iter())
        .filter(|it| gives_up_at.is_none_or(|at| skip_trivia(file.text(), it.noticed) < at))
        .map(|it| {
            SyntaxError::of_oxc(it.label, it.problem.message())
                .help(Cow::Borrowed(it.problem.help()))
                .stage(match it.is_fatal {
                    true => Stage::Fatal,
                    false => Stage::Parser,
                })
                .noticed_at(it.noticed)
        })
        .collect()
}
