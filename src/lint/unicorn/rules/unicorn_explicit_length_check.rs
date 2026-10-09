use crate::unicorn::{
    expression_uses_optional_chain, get_boolean_ancestor, is_boolean_node, is_number_value,
    pad_fix_with_token_boundary,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Enforce explicitly comparing the `length` or `size` property of a value.
pub struct ExplicitLengthCheck {
    /// `!== 0`, not `> 0`.
    is_non_zero_not_equal: bool,
}

const NON_ZERO: Message =
    Message::new("", "Use `.{{prop_name}} {{op_and_rhs}}` when checking {{prop_name}} is not zero.");
const ZERO: Message = Message::new("", "Use `.{{prop_name}} {{op_and_rhs}}` when checking {{prop_name}} is zero.");

/// Whether `comparison` tells that a length is zero (`true`) or that it is not (`false`): `a.length == 0`,
/// `1 <= a.length`.
fn is_zero_length_check(comparison: Expr) -> Option<bool> {
    let ExprKind::Binary { op, left, right } = comparison.kind() else {
        return None;
    };
    let (zero_right, one_right) = (is_number_value(right, 0.0), is_number_value(right, 1.0));
    let (zero_left, one_left) = (is_number_value(left, 0.0), is_number_value(left, 1.0));
    match op {
        BinOp::EqEqEq | BinOp::EqEq if zero_right || zero_left => Some(true),
        BinOp::NotEqEq | BinOp::NotEq if zero_right || zero_left => Some(false),
        BinOp::Lt if one_right => Some(true),
        BinOp::Lt if zero_left => Some(false),
        BinOp::Gt if one_left => Some(true),
        BinOp::Gt if zero_right => Some(false),
        BinOp::Ge if one_right => Some(false),
        BinOp::Le if one_left => Some(false),
        _ => None,
    }
}

fn is_unary_expression(e: Expr) -> bool {
    e.unary_op().is_some_and(|op| !matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec))
}

impl ExplicitLengthCheck {
    /// `node`: what is replaced by a comparison of `member`.
    fn report<'a>(&self, node: Expr<'a>, is_zero: bool, member: Expr<'a>, auto_fix: bool, cx: &Cx<'a, Self>) {
        let (operator, check_code) = match (is_zero, self.is_non_zero_not_equal) {
            (true, _) => (BinOp::EqEqEq, "=== 0"),
            (false, false) => (BinOp::Gt, "> 0"),
            (false, true) => (BinOp::NotEqEq, "!== 0"),
        };
        if matches!(node.kind(), ExprKind::Binary { op, right, .. } if op == operator && is_number_value(right, 0.0)) {
            return;
        }
        let Some(property) = member.member_name() else {
            return;
        };
        cx.report(node, if is_zero { ZERO } else { NON_ZERO })
            .data("prop_name", property)
            .data("op_and_rhs", check_code)
            .fix(|fixer| {
                if !auto_fix {
                    return None;
                }
                let need_paren = is_unary_expression(node)
                    && !node.is_parenthesized()
                    && matches!(node.parent(), Node::Expr(it) if is_unary_expression(it) || it.tag() == ExprTag::Await);
                let (open, close): (&[u8], &[u8]) = if need_paren { (b"(", b")") } else { (b"", b"") };
                let mut fixed = [open, member.text(), b" ", check_code.as_bytes(), close].concat();
                pad_fix_with_token_boundary(fixer.file().text(), node.span(), &mut fixed);
                Some(fixer.replace(node, fixed))
            });
    }
}

impl Rule for ExplicitLengthCheck {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "explicit-length-check", Kind::Suggestion).fixable(Fixable::Code);
    /// See [`is_boolean_node`].
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(options: &Options) -> Self {
        ExplicitLengthCheck { is_non_zero_not_equal: options.object(0).str("non-zero") == Some("not-equal") }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.mentions_any(&["length", "size"]) {
            on.exprs([ExprTag::Dot], Self::check);
        }
        AncestorMemo::default()
    }
}

impl ExplicitLengthCheck {
    fn check<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { obj, name, chain: Chain::No } = member.kind() else {
            return;
        };
        if !name.name().is_any(&["length", "size"])
            || obj.tag() == ExprTag::This && !obj.is_parenthesized()
            || expression_uses_optional_chain(obj)
            || member.is_jsx_tag_name()
            || member.is_in_type_query()
        {
            return;
        }
        // What `member` is directly in, if it is not in parentheses.
        let parent = member.parent().as_expr().filter(|_| !member.is_parenthesized());
        if let Some(comparison) = parent
            && let Some(is_zero) = is_zero_length_check(comparison)
        {
            let (ancestor, is_negative) = get_boolean_ancestor(comparison);
            self.report(ancestor, is_zero != is_negative, member, true, cx);
            return;
        }
        let (ancestor, is_negative) = get_boolean_ancestor(member);
        if is_boolean_node(ancestor, &mut cx.state) {
            self.report(ancestor, is_negative, member, true, cx);
            return;
        }
        // `a.length && b`, `a.length || b`, not `a.length || 1`
        if let Some(ExprKind::Binary { op, right, .. }) = parent.map(Expr::kind)
            && (op == BinOp::And || op == BinOp::Or && (right.tag() != ExprTag::Number || right.is_parenthesized()))
        {
            self.report(ancestor, is_negative, member, false, cx);
        }
    }
}
