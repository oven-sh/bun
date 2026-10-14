use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::tsutils::{CompilerOption, is_strict_compiler_option_enabled};
use bun_lint::types::utils::{get_constraint_info, is_possibly_truthy};
use bun_lint::types::{Type, TypeFlags};
use bun_lint::utils::ts_utils::{
    is_conditional_test, is_missing_semicolon_before, is_strong_precedence_node,
    is_weak_precedence_parent,
};

/// Disallow unnecessary equality comparisons against boolean literals.
pub struct NoUnnecessaryBooleanLiteralCompare {
    allow_comparing_nullable_booleans_to_false: bool,
    allow_comparing_nullable_booleans_to_true: bool,
    allow_rule_to_run_without_strict_null_checks: bool,
}

const COMPARING_NULLABLE_TO_FALSE: Message = Message::new(
    "comparingNullableToFalse",
    "This expression unnecessarily compares a nullable boolean value to false instead of using the ?? operator to provide a default.",
);
const COMPARING_NULLABLE_TO_TRUE_DIRECT: Message = Message::new(
    "comparingNullableToTrueDirect",
    "This expression unnecessarily compares a nullable boolean value to true instead of using it directly.",
);
const COMPARING_NULLABLE_TO_TRUE_NEGATED: Message = Message::new(
    "comparingNullableToTrueNegated",
    "This expression unnecessarily compares a nullable boolean value to true instead of negating it.",
);
const DIRECT: Message = Message::new(
    "direct",
    "This expression unnecessarily compares a boolean value to a boolean instead of using it directly.",
);
const NEGATED: Message = Message::new(
    "negated",
    "This expression unnecessarily compares a boolean value to a boolean instead of negating it.",
);
const NO_STRICT_NULL_CHECK: Message = Message::new(
    "noStrictNullCheck",
    "This rule requires the `strictNullChecks` compiler option to be turned on to function correctly.",
);

#[derive(Copy, Clone)]
struct BooleanComparison<'a> {
    expression: Expr<'a>,
    boolean_literal: bool,
    negated: bool,
    expression_is_nullable_boolean: bool,
}

fn is_boolean_type(expression_type: Type) -> bool {
    expression_type.has_flags(TypeFlags::BOOLEAN | TypeFlags::BOOLEAN_LITERAL)
}

/// A union that has `null` or `undefined`, has `true`, `false` or `boolean`, and has nothing else.
/// tsgolint does not ask for the last: `boolean | string | undefined` is a nullable boolean there.
fn is_nullable_boolean(expression_type: Type, is_oxlint: bool) -> bool {
    if !expression_type.is_union() {
        return false;
    }
    let (mut has_non_nullish_type, mut has_nullable_type) = (false, false);
    for ty in expression_type.types() {
        if ty.has_flags(TypeFlags::UNDEFINED | TypeFlags::NULL) {
            has_nullable_type = true;
        } else if is_boolean_type(ty) {
            has_non_nullish_type = true;
        } else if !is_oxlint {
            return false;
        }
    }
    has_non_nullish_type && has_nullable_type
}

fn boolean_literal(against: Expr) -> Option<bool> {
    match against.kind() {
        ExprKind::True => Some(true),
        ExprKind::False => Some(false),
        _ => None,
    }
}

fn get_boolean_comparison(node: Expr<'_>) -> Option<BooleanComparison<'_>> {
    let ExprKind::Binary { op, left, right } = node.kind() else {
        return None;
    };
    let negated = match op {
        BinOp::NotEq | BinOp::NotEqEq => true,
        BinOp::EqEq | BinOp::EqEqEq => false,
        _ => return None,
    };
    let (boolean_literal, expression) = match (boolean_literal(right), boolean_literal(left)) {
        (Some(value), _) => (value, left),
        (None, Some(value)) => (value, right),
        (None, None) => return None,
    };
    let constraint_type = get_constraint_info(expression.ty()).constraint_type?;
    let expression_is_nullable_boolean = match is_boolean_type(constraint_type) {
        true => false,
        false if is_nullable_boolean(constraint_type, expression.file().language().is_oxlint) => true,
        false => return None,
    };
    Some(BooleanComparison {
        expression,
        boolean_literal,
        negated,
        expression_is_nullable_boolean,
    })
}

fn parenthesize(text: &mut Vec<u8>) {
    text.insert(0, b'(');
    text.push(b')');
}

fn fix<'a>(fixer: Fixer<'a>, node: Expr<'a>, comparison: BooleanComparison<'a>) -> Fix {
    let unary_negation = match node.parent() {
        Node::Expr(parent) if matches!(parent.kind(), ExprKind::Unary { op: UnOp::Not, .. }) => Some(parent),
        _ => None,
    };
    let mutated_node = unary_negation.unwrap_or(node);

    // Whether the truth table of all that is replaced is negated, apart from the nullish cases.
    let is_overall_negated = unary_negation.is_some() ^ comparison.negated ^ !comparison.boolean_literal;

    let mut replacement_text = comparison.expression.text().to_vec();
    let mut may_need_parentheses = !is_strong_precedence_node(comparison.expression);

    let fix_would_return_expression_directly = !is_overall_negated && comparison.expression_is_nullable_boolean;
    if fix_would_return_expression_directly && !is_conditional_test(mutated_node) {
        if may_need_parentheses {
            parenthesize(&mut replacement_text);
        }
        replacement_text.extend_from_slice(b" ?? false");
        may_need_parentheses = true;
    } else {
        // In `maybeNullish === false`, nullish values have the same truth table as `true`.
        if comparison.expression_is_nullable_boolean && !comparison.boolean_literal {
            if may_need_parentheses {
                parenthesize(&mut replacement_text);
            }
            replacement_text.extend_from_slice(b" ?? true");
            may_need_parentheses = true;
        }
        if is_overall_negated {
            if may_need_parentheses {
                parenthesize(&mut replacement_text);
            }
            replacement_text.insert(0, b'!');
            may_need_parentheses = false;
        }
    }
    if may_need_parentheses && is_weak_precedence_parent(mutated_node) {
        parenthesize(&mut replacement_text);
    }
    fixer.replace(mutated_node, replacement_text)
}

/// tsgolint's `isConditionalTest`: through `&&` and `||` only, and all under a `!` is one.
fn is_conditional_test_as_tsgolint(node: Expr<'_>) -> bool {
    let mut node = node;
    loop {
        node = match node.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or,
                    ..
                } => parent,
                ExprKind::Cond { test, .. } => return test == node,
                ExprKind::Unary { op: UnOp::Not, .. } => return true,
                _ => return false,
            },
            Node::Stmt(parent) => {
                return match parent.kind() {
                    StmtKind::DoWhile { test, .. }
                    | StmtKind::If { test, .. }
                    | StmtKind::While { test, .. } => test == node,
                    StmtKind::For { test, .. } => test == Some(node),
                    _ => false,
                };
            }
            _ => return false,
        };
    }
}

/// Whether `node` begins what a `return`, a `throw` or a `yield` has after it: a line break there ends the statement.
fn is_in_restricted_production(node: Expr<'_>) -> bool {
    let mut node = node;
    loop {
        if node.is_parenthesized() {
            return false;
        }
        node = match node.parent() {
            Node::Stmt(parent) => return matches!(parent.kind(), StmtKind::Return(_) | StmtKind::Throw(_)),
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Yield { .. }) => return true,
            Node::Expr(parent) if parent.span().start == node.span().start => parent,
            _ => return false,
        };
    }
}

/// Whether a statement begins with `node`, with no parenthesis before it.
fn is_at_statement_start(node: Expr<'_>) -> bool {
    let mut parent = node.parent();
    loop {
        parent = match parent {
            Node::Stmt(statement) => return statement.span().start == node.span().start,
            Node::Expr(expression) => expression.parent(),
            _ => return false,
        };
    }
}

/// The fix of tsgolint 7.0. What it puts in place of the comparison begins where the token before the expression ends:
/// `a = b === true` becomes `a =  b`. None where tsgolint's text would do something else than the comparison.
fn fix_as_tsgolint<'a>(fixer: Fixer<'a>, node: Expr<'a>, comparison: BooleanComparison<'a>) -> Option<Fix> {
    let unary_negation = match node.parent() {
        Node::Expr(parent) if matches!(parent.kind(), ExprKind::Unary { op: UnOp::Not, .. }) => Some(parent),
        _ => None,
    };
    let mutated_node = unary_negation.unwrap_or(node);
    let (file, expression) = (fixer.file(), comparison.expression);
    let is_nullable = comparison.expression_is_nullable_boolean;
    if is_nullable {
        // tsgolint also rewrites `boolean | string | undefined`, where `x === true` is not `!!x`.
        // A `void` member is `undefined`, and one that is always falsy, as `0`, is never `true`.
        let constraint_type = get_constraint_info(expression.ty()).constraint_type?;
        for member in constraint_type.types() {
            let is_boolean_or_nullish = is_boolean_type(member)
                || member.has_flags(TypeFlags::UNDEFINED | TypeFlags::NULL | TypeFlags::VOID);
            if !is_boolean_or_nullish && (!comparison.boolean_literal || is_possibly_truthy(member)) {
                return None;
            }
        }
    }
    let whole = expression.outer_span();
    let mut text = file.slice(Span::new(file.end_of_token_before(whole.start), whole.end));
    // For tsgolint every member access and every call is strong, an optional chain too.
    let is_strong = expression.is_parenthesized()
        || is_strong_precedence_node(expression)
        || matches!(expression.tag(), ExprTag::Call | ExprTag::Dot | ExprTag::Index);
    let adds_negation = (comparison.negated != comparison.boolean_literal) == unary_negation.is_some();

    let (mut before, mut after) = (Vec::new(), Vec::new());
    if is_nullable && comparison.boolean_literal && !adds_negation && !is_conditional_test_as_tsgolint(mutated_node) {
        let (open, close): (&[u8], &[u8]) = if is_strong { (b"(!!", b")") } else { (b"(!!(", b"))") };
        before.extend_from_slice(open);
        after.extend_from_slice(close);
        text = text.trim_ascii();
    } else {
        if adds_negation {
            before.push(b'!');
            if !is_strong {
                before.push(b'(');
                after.push(b')');
            }
        }
        if is_nullable && !comparison.boolean_literal {
            before.push(b'(');
            after.extend_from_slice(b" ?? true)");
        }
        // tsgolint has no parentheses here: `return true ===\n x` would return nothing, `!!(a < b !== true)` be `!a < b`.
        let breaks_line = mutated_node.span().start != whole.start
            && text.strip_suffix(file.slice(whole)).is_some_and(strings::contains_js_line_break)
            && is_in_restricted_production(mutated_node);
        let is_operand = unary_negation.is_some()
            && !is_strong
            && !mutated_node.is_parenthesized()
            && is_weak_precedence_parent(mutated_node)
            && !matches!(
                mutated_node.parent(),
                Node::Expr(parent) if matches!(
                    parent.kind(),
                    ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } | ExprKind::Cond { .. }
                )
            );
        if before.is_empty() && (breaks_line || is_operand) {
            before.push(b'(');
            after.push(b')');
        }
    }
    // tsgolint has no `;` here: `a()\n(!!x)` would be a call.
    if before.first() == Some(&b'(') && is_at_statement_start(mutated_node) && is_missing_semicolon_before(mutated_node) {
        before.insert(0, b';');
    }
    Some(fixer.replace(mutated_node, [before.as_slice(), text, after.as_slice()].concat()))
}

impl NoUnnecessaryBooleanLiteralCompare {
    fn check<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(comparison) = get_boolean_comparison(node) else {
            return;
        };
        let message = match (comparison.expression_is_nullable_boolean, comparison.boolean_literal) {
            (true, true) if self.allow_comparing_nullable_booleans_to_true => return,
            (true, false) if self.allow_comparing_nullable_booleans_to_false => return,
            (true, true) if comparison.negated => COMPARING_NULLABLE_TO_TRUE_NEGATED,
            (true, true) => COMPARING_NULLABLE_TO_TRUE_DIRECT,
            (true, false) => COMPARING_NULLABLE_TO_FALSE,
            (false, _) if comparison.negated => NEGATED,
            (false, _) => DIRECT,
        };
        let is_oxlint = cx.language().is_oxlint;
        cx.report(node, message).fix(|fixer| match is_oxlint {
            true => fix_as_tsgolint(fixer, node, comparison),
            false => Some(fix(fixer, node, comparison)),
        });
    }
}

impl Rule for NoUnnecessaryBooleanLiteralCompare {
    const META: Meta = Meta::typescript("no-unnecessary-boolean-literal-compare", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().finish().exprs(&[ExprTag::Binary]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoUnnecessaryBooleanLiteralCompare {
            allow_comparing_nullable_booleans_to_false: options
                .bool_or("allowComparingNullableBooleansToFalse", true),
            allow_comparing_nullable_booleans_to_true: options
                .bool_or("allowComparingNullableBooleansToTrue", true),
            allow_rule_to_run_without_strict_null_checks: options
                .bool_or("allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        let compiler_options = file.type_checker().compiler_options();
        if !is_strict_compiler_option_enabled(compiler_options, CompilerOption::StrictNullChecks)
            && !self.allow_rule_to_run_without_strict_null_checks
        {
            on = on.finish();
        }
        on.exprs(&[ExprTag::Binary])
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(node, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        ts_utils::report_at_line_zero(cx, NO_STRICT_NULL_CHECK);
    }
}
