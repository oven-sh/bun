use bun_lint::prelude::*;
use bun_lint::types::tsutils::{CompilerOption, is_strict_compiler_option_enabled};
use bun_lint::types::utils::get_constraint_info;
use bun_lint::types::{Type, TypeFlags};
use bun_lint::utils::ts_utils::{
    is_conditional_test, is_strong_precedence_node, is_weak_precedence_parent,
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
fn is_nullable_boolean(expression_type: Type) -> bool {
    if !expression_type.is_union() {
        return false;
    }
    let (mut has_non_nullish_type, mut has_nullable_type) = (false, false);
    for ty in expression_type.types() {
        if ty.has_flags(TypeFlags::UNDEFINED | TypeFlags::NULL) {
            has_nullable_type = true;
        } else if is_boolean_type(ty) {
            has_non_nullish_type = true;
        } else {
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
        false if is_nullable_boolean(constraint_type) => true,
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

/// The fix of tsgolint 7.0. What it puts in place of the comparison begins where the token before the expression ends:
/// `a = b === true` becomes `a =  b`.
fn fix_as_tsgolint<'a>(fixer: Fixer<'a>, node: Expr<'a>, comparison: BooleanComparison<'a>) -> Fix {
    let unary_negation = match node.parent() {
        Node::Expr(parent) if matches!(parent.kind(), ExprKind::Unary { op: UnOp::Not, .. }) => Some(parent),
        _ => None,
    };
    let mutated_node = unary_negation.unwrap_or(node);
    let (file, expression) = (fixer.file(), comparison.expression);
    let whole = expression.outer_span();
    let text = file.slice(Span::new(file.end_of_token_before(whole.start), whole.end));
    let is_strong = expression.is_parenthesized() || is_strong_precedence_node(expression);
    let is_nullable = comparison.expression_is_nullable_boolean;
    let adds_negation = (comparison.negated != comparison.boolean_literal) == unary_negation.is_some();

    if is_nullable && comparison.boolean_literal && !adds_negation && !is_conditional_test(mutated_node) {
        let (open, close): (&[u8], &[u8]) = if is_strong { (b"(!!", b")") } else { (b"(!!(", b"))") };
        return fixer.replace(mutated_node, [open, text.trim_ascii(), close].concat());
    }
    let (mut before, mut after) = (Vec::new(), Vec::new());
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
    fixer.replace(mutated_node, [before.as_slice(), text, after.as_slice()].concat())
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
            false => fix(fixer, node, comparison),
        });
    }
}

impl Rule for NoUnnecessaryBooleanLiteralCompare {
    const META: Meta = Meta::typescript("no-unnecessary-boolean-literal-compare", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let compiler_options = file.type_checker().compiler_options();
        if !is_strict_compiler_option_enabled(compiler_options, CompilerOption::StrictNullChecks)
            && !self.allow_rule_to_run_without_strict_null_checks
        {
            on.finish(|_, cx| {
                // tsgolint points at the start of the file.
                if cx.language().is_oxlint {
                    cx.report(Span::empty(0), NO_STRICT_NULL_CHECK);
                    return;
                }
                let line_zero = Position { line: 0, column: 0 };
                cx.report(Span::empty(0), NO_STRICT_NULL_CHECK).start_at(line_zero).end_at(line_zero);
            });
        }
        on.exprs([ExprTag::Binary], Self::check);
    }
}
