use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    CompilerOption, is_intrinsic_error_type, is_strict_compiler_option_enabled,
};
use bun_lint::types::utils::{get_constrained_type_at_location, is_type_any_type};
use bun_lint::utils::ts_utils::get_this_expression;

/// Disallow member access on a value with type `any`.
pub struct NoUnsafeMemberAccess {
    allow_optional_chaining: bool,
}

const ERROR_COMPUTED_MEMBER_ACCESS: Message = Message::new(
    "errorComputedMemberAccess",
    "The type of computed name {{property}} cannot be resolved.",
);
const ERROR_MEMBER_EXPRESSION: Message = Message::new(
    "errorMemberExpression",
    "Unsafe member access {{property}} on a type that cannot be resolved.",
);
const ERROR_THIS_MEMBER_EXPRESSION: Message = Message::new(
    "errorThisMemberExpression",
    "Unsafe member access {{property}}. The type of `this` cannot be resolved.\nYou can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.",
);
const UNSAFE_COMPUTED_MEMBER_ACCESS: Message = Message::new(
    "unsafeComputedMemberAccess",
    "Computed name {{property}} resolves to an `any` value.",
);
const UNSAFE_MEMBER_EXPRESSION: Message = Message::new(
    "unsafeMemberExpression",
    "Unsafe member access {{property}} on an `any` value.",
);
const UNSAFE_THIS_MEMBER_EXPRESSION: Message = Message::new(
    "unsafeThisMemberExpression",
    "Unsafe member access {{property}} on an `any` value. `this` is typed as `any`.\nYou can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.",
);

/// The `object` of a `MemberExpression`.
fn object_of(node: Expr<'_>) -> Option<Expr<'_>> {
    match node.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
        _ => None,
    }
}

/// `TSClassImplements MemberExpression, TSInterfaceHeritage MemberExpression`: it is in a type
/// argument there.
fn is_in_implements_or_interface_heritage(node: Expr) -> bool {
    Node::Expr(node).ancestors().any(|ancestor| {
        let Node::Type(ty) = ancestor else {
            return false;
        };
        match ty.parent() {
            Node::Class(class) => class.implements().iter().any(|it| it == ty),
            Node::Stmt(parent) => {
                matches!(parent.kind(), StmtKind::Interface(it) if it.extends().iter().any(|it| it == ty))
            }
            _ => false,
        }
    })
}

impl NoUnsafeMemberAccess {
    /// Whether the member expression `node`, or one that it starts with, reads from an `any`.
    fn is_unsafe(&self, mut node: Expr) -> bool {
        loop {
            let Some(object) = object_of(node) else {
                return false;
            };
            if self.allow_optional_chaining && node.is_optional() {
                return false;
            }
            if is_type_any_type(object.ty()) {
                return true;
            }
            // In parentheses, a chain is a `ChainExpression`.
            if object.is_chain_root() {
                return false;
            }
            node = object;
        }
    }

    fn check_member_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (object, property, computed) = match node.kind() {
            ExprKind::Dot { obj, name, .. } => (obj, name.span(), false),
            ExprKind::Index { obj, index, .. } => (obj, index.span(), true),
            _ => return,
        };
        if self.allow_optional_chaining && node.is_optional() {
            return;
        }
        if !computed && (node.is_in_type_query() || node.is_jsx_tag_name()) {
            return;
        }
        let ty = object.ty();
        if !is_type_any_type(ty) {
            return;
        }
        // It is reported where the first of them is.
        if !object.is_chain_root() && self.is_unsafe(object) {
            return;
        }
        if is_in_implements_or_interface_heritage(node) {
            return;
        }

        let options = cx.file().type_checker().compiler_options();
        let this_type = match is_strict_compiler_option_enabled(options, CompilerOption::NoImplicitThis) {
            true => None,
            false => get_this_expression(node)
                .map(get_constrained_type_at_location)
                .filter(|this_type| is_type_any_type(*this_type)),
        };
        let message = match this_type {
            Some(this_type) if is_intrinsic_error_type(this_type) => ERROR_THIS_MEMBER_EXPRESSION,
            Some(_) => UNSAFE_THIS_MEMBER_EXPRESSION,
            None if is_intrinsic_error_type(ty) => ERROR_MEMBER_EXPRESSION,
            None => UNSAFE_MEMBER_EXPRESSION,
        };
        let property_name = cx.slice(property);
        let property_text = match computed {
            true => [&b"["[..], property_name, b"]"].concat(),
            false => [&b"."[..], property_name].concat(),
        };
        cx.report(property, message).data("property", property_text);
    }

    fn check_computed_property<'a>(&self, parent: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Index { index: node, .. } = parent.kind() else {
            return;
        };
        if self.allow_optional_chaining && parent.is_optional() {
            return;
        }
        match node.kind() {
            ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => return,
            _ => {}
        }
        let ty = node.ty();
        if !is_type_any_type(ty) {
            return;
        }
        let message = match is_intrinsic_error_type(ty) {
            true => ERROR_COMPUTED_MEMBER_ACCESS,
            false => UNSAFE_COMPUTED_MEMBER_ACCESS,
        };
        cx.report(node, message).data("property", [&b"["[..], node.text(), b"]"].concat());
    }
}

impl Rule for NoUnsafeMemberAccess {
    const META: Meta = Meta::typescript("no-unsafe-member-access", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUnsafeMemberAccess {
            allow_optional_chaining: options.object(0).bool_or("allowOptionalChaining", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Dot, ExprTag::Index], Self::check_member_expression);
        on.exprs([ExprTag::Index], Self::check_computed_property);
    }
}
