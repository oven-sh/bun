use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    CompilerOption, is_intrinsic_error_type, is_intrinsic_void_type,
    is_strict_compiler_option_enabled,
};
use bun_lint::types::utils::{
    get_constrained_type_at_location, is_builtin_symbol_like, is_type_any_type,
};
use bun_lint::utils::ts_utils::get_this_expression;

/// Disallow calling a value with type `any`.
pub struct NoUnsafeCall;

const ERROR_CALL: Message =
    Message::new("errorCall", "Unsafe call of a type that could not be resolved.");
const ERROR_CALL_THIS: Message = Message::new(
    "errorCallThis",
    "Unsafe call of a `this` type that could not be resolved.",
);
const ERROR_NEW: Message = Message::new(
    "errorNew",
    "Unsafe construction of a type that could not be resolved.",
);
const ERROR_TEMPLATE_TAG: Message = Message::new(
    "errorTemplateTag",
    "Unsafe use of a template tag whose type could not be resolved.",
);
const UNSAFE_CALL: Message = Message::new("unsafeCall", "Unsafe call of {{type}} typed value.");
const UNSAFE_CALL_THIS: Message = Message::new(
    "unsafeCallThis",
    "Unsafe call of {{type}} typed value. `this` is typed as {{type}}.\nYou can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.",
);
const UNSAFE_NEW: Message =
    Message::new("unsafeNew", "Unsafe construction of {{type}} typed value.");
const UNSAFE_TEMPLATE_TAG: Message =
    Message::new("unsafeTemplateTag", "Unsafe use of {{type}} typed template tag.");

#[derive(Copy, Clone, PartialEq, Eq)]
enum Use {
    Call,
    New,
    TemplateTag,
}

fn check_call<'a>(node: Expr<'a>, reporting_node: Expr<'a>, how: Use, cx: &Cx<'a, NoUnsafeCall>) {
    let (unsafe_message, error_message) = match how {
        Use::Call => (UNSAFE_CALL, ERROR_CALL),
        Use::New => (UNSAFE_NEW, ERROR_NEW),
        Use::TemplateTag => (UNSAFE_TEMPLATE_TAG, ERROR_TEMPLATE_TAG),
    };
    let ty = get_constrained_type_at_location(node);

    if is_type_any_type(ty) {
        let options = cx.file().type_checker().compiler_options();
        // `this()`, `this.foo()`, `this.foo[bar]()`
        let is_this_any = !is_strict_compiler_option_enabled(options, CompilerOption::NoImplicitThis)
            && get_this_expression(node)
                .is_some_and(|this| is_type_any_type(get_constrained_type_at_location(this)));
        let message = match (is_intrinsic_error_type(ty), is_this_any) {
            (true, true) => ERROR_CALL_THIS,
            (true, false) => error_message,
            (false, true) => UNSAFE_CALL_THIS,
            (false, false) => unsafe_message,
        };
        cx.report(reporting_node, message).data("type", "an `any`");
        return;
    }

    // Also what extends `Function`, as `interface Foo extends Function {}`. Such a type is safe to
    // call with a call or a construct signature, and safe to construct with a construct signature
    // or a call signature that does not return `void`.
    if is_builtin_symbol_like(ty, "Function") {
        if !ty.get_construct_signatures().is_empty() {
            return;
        }
        let call_signatures = ty.get_call_signatures();
        let is_safe = match how {
            Use::New => call_signatures
                .iter()
                .any(|signature| !is_intrinsic_void_type(signature.get_return_type())),
            Use::Call | Use::TemplateTag => !call_signatures.is_empty(),
        };
        if !is_safe {
            cx.report(reporting_node, unsafe_message).data("type", "a `Function`");
        }
    }
}

impl Rule for NoUnsafeCall {
    const META: Meta = Meta::typescript("no-unsafe-call", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnsafeCall
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs(
            [ExprTag::Call, ExprTag::New, ExprTag::TaggedTemplate],
            |_, node, cx| match node.kind() {
                ExprKind::Call(call) => check_call(call.callee(), call.callee(), Use::Call, cx),
                ExprKind::New(call) => check_call(call.callee(), node, Use::New, cx),
                ExprKind::TaggedTemplate(call) => {
                    check_call(call.callee(), call.callee(), Use::TemplateTag, cx);
                }
                _ => {}
            },
        );
    }
}
