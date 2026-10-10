use crate::util_variable::get_variable_from_context;
use crate::util_version::get_react_version_from_context;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow problematic leaked values from being rendered.
pub struct JsxNoLeakedRender {
    allows_ternary: bool,
    allows_coerce: bool,
    /// The first of `validStrategies`.
    fix_strategy: Option<Strategy>,
}

#[derive(Copy, Clone)]
enum Strategy {
    Ternary,
    Coerce,
}

const NO_POTENTIAL_LEAKED_RENDER: Message = Message::new(
    "noPotentialLeakedRender",
    "Potential leaked value that might cause unintentionally rendered values or rendering crashes",
);

impl Rule for JsxNoLeakedRender {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-no-leaked-render", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let given = config.strings("validStrategies");
        let strategies = if config.has("validStrategies") { &given[..] } else { &["ternary", "coerce"][..] };
        let strategy_of = |it: &&str| if *it == "coerce" { Strategy::Coerce } else { Strategy::Ternary };
        JsxNoLeakedRender {
            allows_ternary: strategies.contains(&"ternary"),
            allows_coerce: strategies.contains(&"coerce"),
            fix_strategy: strategies.first().map(strategy_of),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.has_exprs([ExprTag::Jsx]) {
            return;
        }
        on.binaries([BinOp::And], check_logical_expression);
        if !self.allows_ternary {
            on.exprs([ExprTag::Cond], check_conditional_expression);
        }
    }
}

impl JsxNoLeakedRender {
    /// `ruleFixer`. Without a strategy upstream throws.
    fn fix<'a>(&self, fixer: Fixer<'a>, reported: Expr<'a>, left: Expr<'a>, right: Expr<'a>) -> Option<Fix> {
        let text = match self.fix_strategy? {
            Strategy::Coerce => coerced(reported, left, right)?,
            Strategy::Ternary => {
                let mut trimmed = left;
                while let Some(argument) = unary_argument(trimmed).and_then(unary_argument) {
                    trimmed = argument;
                }
                let (open, close): (&[u8], &[u8]) = if left.is_parenthesized() { (b"(", b")") } else { (b"", b"") };
                [open, trimmed.text(), close, b" ? ", right.text(), b" : null"].concat()
            }
        };
        Some(fixer.replace(reported, text))
    }
}

fn check_logical_expression<'a>(rule: &JsxNoLeakedRender, e: Expr<'a>, cx: &mut Cx<'a, JsxNoLeakedRender>) {
    // `JSXExpressionContainer > ..`
    if e.jsx_container_span().is_none() {
        return;
    }
    let ExprKind::Binary { left, right, .. } = e.kind() else {
        return;
    };
    let is_valid = (rule.allows_coerce
        && (is_coerce_valid_nested_logical_expression(left) || is_declared_as_boolean(left)))
        || (left.as_string().is_some_and(|it| it.bytes().is_empty())
            && get_react_version_from_context(cx.file()) >= (18, 0, 0));
    if !is_valid {
        cx.report(e, NO_POTENTIAL_LEAKED_RENDER).fix(|fixer| rule.fix(fixer, e, left, right));
    }
}

fn check_conditional_expression<'a>(rule: &JsxNoLeakedRender, e: Expr<'a>, cx: &mut Cx<'a, JsxNoLeakedRender>) {
    // `JSXExpressionContainer > ..`
    if e.jsx_container_span().is_none() {
        return;
    }
    let ExprKind::Cond { test, yes, no } = e.kind() else {
        return;
    };
    // `TERNARY_INVALID_ALTERNATE_VALUES`: `undefined` is also the `value` of what is no `Literal`.
    let is_valid_alternate = match no.kind() {
        ExprKind::Jsx(jsx) => !jsx.is_fragment(),
        _ => ast_utils::is_literal(no) && !matches!(no.tag(), ExprTag::Null | ExprTag::False),
    };
    if !is_valid_alternate {
        cx.report(e, NO_POTENTIAL_LEAKED_RENDER).fix(|fixer| rule.fix(fixer, e, test, yes));
    }
}

fn is_logical_expression(e: Expr) -> bool {
    matches!(e.binary_op(), Some(BinOp::And | BinOp::Or | BinOp::Nullish))
}

/// The `argument` of a `UnaryExpression`.
fn unary_argument(e: Expr<'_>) -> Option<Expr<'_>> {
    match e.kind() {
        ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => None,
        ExprKind::Unary { operand, .. } => Some(operand),
        _ => None,
    }
}

/// `getIsCoerceValidNestedLogicalExpression`
fn is_coerce_valid_nested_logical_expression(mut e: Expr) -> bool {
    while let ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } = e.kind() {
        if !is_coerce_valid_nested_logical_expression(right) {
            return false;
        }
        e = left;
    }
    // `COERCE_VALID_LEFT_SIDE_EXPRESSIONS`: a `UnaryExpression`, a `BinaryExpression` or a `CallExpression`.
    match e.kind() {
        ExprKind::Binary { op, .. } => op != BinOp::Comma,
        ExprKind::Call(_) => !e.is_chain_root(),
        _ => unary_argument(e).is_some(),
    }
}

/// `extractExpressionBetweenLogicalAnds`
fn extract_expression_between_logical_ands<'a>(mut e: Expr<'a>, all: &mut Vec<Expr<'a>>) {
    let mut operands = Vec::new();
    while let ExprKind::Binary { op: BinOp::And, left, right } = e.kind() {
        operands.push(right);
        e = left;
    }
    all.push(e);
    for operand in operands.into_iter().rev() {
        extract_expression_between_logical_ands(operand, all);
    }
}

/// It is a variable whose first declaration has `true` or `false` as its `init`.
fn is_declared_as_boolean(e: Expr) -> bool {
    let init = || match get_variable_from_context(Node::Expr(e), e.as_ident()?)?.declarations().next()?.node()? {
        Node::VarDecl(declaration) => declaration.init(),
        _ => None,
    };
    matches!(init().map(Expr::tag), Some(ExprTag::True | ExprTag::False))
}

/// What the strategy `coerce` writes in place of `reported`.
fn coerced<'a>(reported: Expr<'a>, left: Expr<'a>, right: Expr<'a>) -> Option<Vec<u8>> {
    // The `no` of `left ? false : no`.
    let alternate_of_false = match reported.kind() {
        ExprKind::Cond { yes, no, .. } if yes.tag() == ExprTag::False => Some(no),
        _ => None,
    };
    let mut expressions = Vec::new();
    extract_expression_between_logical_ands(left, &mut expressions);
    let mut out = Vec::new();
    for (index, &it) in expressions.iter().enumerate() {
        let separator: &[u8] = if index > 0 { b" && " } else { b"" };
        let coercion: &[u8] = match is_coerce_valid_nested_logical_expression(it) {
            true => b"",
            false if alternate_of_false.is_some() && it == left => b"!",
            false => b"!!",
        };
        let (open, close): (&[u8], &[u8]) = if it.is_parenthesized() { (b"(", b")") } else { (b"", b"") };
        out.extend_from_slice(&[separator, coercion, open, it.text(), close].concat());
    }
    if let Some(alternate) = alternate_of_false {
        let value = match alternate.as_ident() {
            Some(name) => name.bytes(),
            None if ast_utils::is_literal(alternate) => alternate.text(),
            None => b"undefined",
        };
        let operator: &[u8] = if is_logical_expression(left) { b" ? false : " } else { b" && " };
        return Some([&out[..], operator, value].concat());
    }
    let right_text = right.text();
    if ast_utils::is_literal(right) {
        return None;
    }
    if right.tag() == ExprTag::Cond || is_logical_expression(right) {
        return Some([&out[..], b" && (", right_text, b")"].concat());
    }
    if matches!(right.kind(), ExprKind::Jsx(jsx) if !jsx.is_fragment())
        && let Some(line_break) = strings::last_index_of_char(right_text, b'\n')
    {
        let mut last_line = right_text.get(line_break + 1..)?;
        let mut indent = 0usize;
        while let len @ 1.. = strings::js_whitespace_len(last_line) {
            last_line = last_line.get(len..)?;
            indent += 1;
        }
        // Upstream throws if there are fewer than two.
        let (start, close) = (b" ".repeat(indent), b" ".repeat(indent.checked_sub(2)?));
        return Some([&out[..], b" && (\n", &start, right_text, b"\n", &close, b")"].concat());
    }
    Some([&out[..], b" && ", right_text].concat())
}
