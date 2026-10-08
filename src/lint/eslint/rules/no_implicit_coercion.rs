use bun_lint::prelude::*;

/// Disallow shorthand type conversions.
pub struct NoImplicitCoercion {
    /// `!!foo`
    checks_double_negation: bool,
    /// `~foo.indexOf(bar)`
    checks_index_of: bool,
    /// `+foo`
    checks_unary_plus: bool,
    /// `-(-foo)`
    checks_double_minus: bool,
    /// `1 * foo`
    checks_multiplication: bool,
    /// `foo - 0`
    checks_subtraction: bool,
    /// `"" + foo`, `foo += ""`
    checks_concatenation: bool,
    /// `` `${foo}` ``
    checks_templates: bool,
}

const IMPLICIT_COERCION: Message = Message::new(
    "implicitCoercion",
    "Unexpected implicit coercion encountered. Use `{{recommendation}}` instead.",
);
const USE_RECOMMENDATION: Message =
    Message::new("useRecommendation", "Use `{{recommendation}}` instead.");

/// What is offered besides the message.
#[derive(Copy, Clone)]
enum Remedy {
    Nothing,
    Suggestion,
    Fix,
}

/// A `Literal` whose value is `value`.
fn is_number(e: Expr, value: f64) -> bool {
    matches!(e.kind(), ExprKind::Number(it) if it == value)
}

/// `node.type === "BinaryExpression"`
fn is_binary_expression(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Binary { op, .. }
        if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma))
}

/// The name of the function, if `e` is a `CallExpression` of an identifier. `f?.()` is a
/// `ChainExpression`.
fn called_name(e: Expr<'_>) -> Option<Name<'_>> {
    match e.kind() {
        ExprKind::Call(call) if call.chain() == Chain::No => call.callee().as_ident(),
        _ => None,
    }
}

/// The operand, if `e` is the unary operator `op`.
fn operand_of(e: Expr<'_>, op: UnOp) -> Option<Expr<'_>> {
    match e.kind() {
        ExprKind::Unary { op: it, operand } if it == op => Some(operand),
        _ => None,
    }
}

/// ESLint's `isMultiplyByFractionOfOne`: the `a * 1` of `a * 1 / b`, which reads as `a * (1 / b)`.
fn is_multiply_by_fraction_of_one<'a>(e: Expr<'a>, right: Expr<'a>) -> bool {
    is_number(right, 1.0)
        && !e.is_parenthesized()
        && matches!(e.parent(), Node::Expr(parent)
            if matches!(parent.kind(), ExprKind::Binary { op: BinOp::Div, left, .. } if left == e))
}

/// ESLint's `isNumeric`: a number, or a call of `Number`, `parseInt` or `parseFloat`.
fn is_numeric(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Number(_))
        || called_name(e).is_some_and(|it| it.is_any(&["Number", "parseInt", "parseFloat"]))
}

/// ESLint's `getNonNumericOperand`.
fn get_non_numeric_operand<'a>(left: Expr<'a>, right: Expr<'a>) -> Option<Expr<'a>> {
    [right, left].into_iter().find(|it| !is_binary_expression(*it) && !is_numeric(*it))
}

/// ESLint's `isStringType`.
fn is_string_type(e: Expr) -> bool {
    ast_utils::is_string_literal(e) || called_name(e).is_some_and(|it| it.is("String"))
}

/// ESLint's `isEmptyString`.
fn is_empty_string(e: Expr) -> bool {
    match e.kind() {
        ExprKind::String(value) => value.bytes().is_empty(),
        ExprKind::Template(template) => template.as_static().is_some_and(|it| it.bytes().is_empty()),
        _ => false,
    }
}

/// `callee(operand)`. ESLint's `getOperandText`: the commas of a sequence would separate arguments.
fn call_of(callee: &str, operand: Expr) -> Vec<u8> {
    let (open, close) = match operand.kind() {
        ExprKind::Binary { op: BinOp::Comma, .. } => ("((", "))"),
        _ => ("(", ")"),
    };
    [callee.as_bytes(), open.as_bytes(), operand.text(), close.as_bytes()].concat()
}

/// Whether `Boolean` at `node` is the global variable.
fn is_boolean_available(node: Expr) -> bool {
    Node::Expr(node).scope().resolve("Boolean").is_none() && node.file().global(b"Boolean").is_some()
}

/// The first token of `recommendation`, if it starts with a call of one of the three functions. All of it otherwise.
fn first_token_of(recommendation: &[u8]) -> &[u8] {
    let is_called = |name: &&[u8]| recommendation.strip_prefix(*name).is_some_and(|rest| rest.starts_with(b"("));
    [&b"Boolean"[..], b"Number", b"String"].into_iter().find(is_called).unwrap_or(recommendation)
}

fn fix<'a>(fixer: Fixer<'a>, node: Expr<'a>, recommendation: &[u8]) -> Fix {
    // A text is split into tokens to its end, which for each of `!!!!..a` is the rest of the chain.
    let needs_space = fixer.file().token_before(node).is_some_and(|before| {
        before.end() == node.span().start && !ast_utils::can_tokens_be_adjacent(before, first_token_of(recommendation))
    });
    match needs_space {
        true => fixer.replace(node, [&b" "[..], recommendation].concat()),
        false => fixer.replace(node, recommendation),
    }
}

fn report<'a>(node: Expr<'a>, recommendation: &[u8], remedy: Remedy, cx: &Cx<'a, NoImplicitCoercion>) {
    let report = cx.report(node, IMPLICIT_COERCION).data("recommendation", recommendation.to_vec());
    match remedy {
        Remedy::Nothing => report,
        Remedy::Suggestion => report.suggest_with(
            USE_RECOMMENDATION,
            &[("recommendation", recommendation)],
            |fixer| fix(fixer, node, recommendation),
        ),
        Remedy::Fix => report.fix(|fixer| fix(fixer, node, recommendation)),
    };
}

// Each check quotes its operand, so none goes on once nothing more is shown: the operands of a chain are as long as the chain.
impl NoImplicitCoercion {
    fn check_unary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if cx.has_reported_too_much() {
            return;
        }
        let ExprKind::Unary { op, operand } = e.kind() else {
            return;
        };
        match op {
            UnOp::Not if self.checks_double_negation => {
                if let Some(inner) = operand_of(operand, UnOp::Not) {
                    let remedy = match is_boolean_available(e) {
                        true => Remedy::Fix,
                        false => Remedy::Suggestion,
                    };
                    report(e, &call_of("Boolean", inner), remedy, cx);
                }
            }
            UnOp::BitNot if self.checks_index_of => {
                if let Some(call) = operand.as_call()
                    && ast_utils::is_member_access_of_any(call.callee(), &["indexOf", "lastIndexOf"])
                {
                    // `foo?.indexOf(bar) !== -1` is true if `foo` is nullish.
                    let comparison: &[u8] = match operand.is_in_optional_chain() {
                        true => b" >= 0",
                        false => b" !== -1",
                    };
                    report(e, &[operand.text(), comparison].concat(), Remedy::Nothing, cx);
                }
            }
            UnOp::Plus if self.checks_unary_plus && !is_numeric(operand) => {
                report(e, &call_of("Number", operand), Remedy::Suggestion, cx);
            }
            UnOp::Minus if self.checks_double_minus => {
                if let Some(inner) = operand_of(operand, UnOp::Minus)
                    && !is_numeric(inner)
                {
                    report(e, &call_of("Number", inner), Remedy::Suggestion, cx);
                }
            }
            _ => {}
        }
    }

    fn check_binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if cx.has_reported_too_much() {
            return;
        }
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        match op {
            BinOp::Mul if self.checks_multiplication => {
                if (is_number(left, 1.0) || is_number(right, 1.0))
                    && !is_multiply_by_fraction_of_one(e, right)
                    && let Some(operand) = get_non_numeric_operand(left, right)
                {
                    report(e, &call_of("Number", operand), Remedy::Suggestion, cx);
                }
            }
            BinOp::Sub if self.checks_subtraction && is_number(right, 0.0) && !is_numeric(left) => {
                report(e, &call_of("Number", left), Remedy::Suggestion, cx);
            }
            BinOp::Add if self.checks_concatenation => {
                let operand = if is_empty_string(left) && !is_string_type(right) {
                    right
                } else if is_empty_string(right) && !is_string_type(left) {
                    left
                } else {
                    return;
                };
                report(e, &call_of("String", operand), Remedy::Suggestion, cx);
            }
            _ => {}
        }
    }

    fn check_assignment<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Assign { op: Some(BinOp::Add), target, value } = e.kind()
            && is_empty_string(value)
            && !cx.has_reported_too_much()
        {
            let code = target.text();
            report(e, &[code, b" = String(", code, b")"].concat(), Remedy::Suggestion, cx);
        }
    }

    fn check_template<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if cx.has_reported_too_much() {
            return;
        }
        let ExprKind::Template(template) = e.kind() else {
            return;
        };
        let is_empty = |i: usize| template.cooked(i).is_some_and(|it| it.bytes().is_empty());
        if template.exprs().len() == 1
            && let Some(only) = template.exprs().first()
            && is_empty(0)
            && is_empty(1)
            && !is_string_type(only)
            && !matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::TaggedTemplate)
        {
            report(e, &call_of("String", only), Remedy::Suggestion, cx);
        }
    }
}

impl Rule for NoImplicitCoercion {
    const META: Meta = Meta::eslint("no-implicit-coercion", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let allowed = object.strings("allow");
        let checks = |kind: &str, operator: &str| object.bool_or(kind, true) && !allowed.contains(&operator);
        NoImplicitCoercion {
            checks_double_negation: checks("boolean", "!!"),
            checks_index_of: checks("boolean", "~"),
            checks_unary_plus: checks("number", "+"),
            checks_double_minus: checks("number", "- -"),
            checks_multiplication: checks("number", "*"),
            checks_subtraction: checks("number", "-"),
            checks_concatenation: checks("string", "+"),
            checks_templates: object.bool_or("disallowTemplateShorthand", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.checks_double_negation
            || self.checks_index_of
            || self.checks_unary_plus
            || self.checks_double_minus
        {
            on.exprs([ExprTag::Unary], Self::check_unary);
        }
        if self.checks_multiplication || self.checks_subtraction || self.checks_concatenation {
            on.exprs([ExprTag::Binary], Self::check_binary);
        }
        if self.checks_concatenation {
            on.exprs([ExprTag::Assign], Self::check_assignment);
        }
        if self.checks_templates {
            on.exprs([ExprTag::Template], Self::check_template);
        }
    }
}
