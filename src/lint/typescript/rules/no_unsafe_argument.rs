use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::types::tsutils::is_intrinsic_error_type;
use bun_lint::types::utils::{
    FunctionSignature, is_type_any_array_type, is_type_any_type, is_unsafe_assignment,
};

/// Disallow calling a function with a value with type `any`.
pub struct NoUnsafeArgument;

const UNSAFE_ARGUMENT: Message = Message::new(
    "unsafeArgument",
    "Unsafe argument of type {{sender}} assigned to a parameter of type {{receiver}}.",
);
const UNSAFE_ARRAY_SPREAD: Message =
    Message::new("unsafeArraySpread", "Unsafe spread of an {{sender}} array type.");
const UNSAFE_SPREAD: Message = Message::new("unsafeSpread", "Unsafe spread of an {{sender}} type.");
const UNSAFE_TUPLE_SPREAD: Message = Message::new(
    "unsafeTupleSpread",
    "Unsafe spread of a tuple type. The argument is {{sender}} and is assigned to a parameter of type {{receiver}}.",
);

fn describe_type(ty: Type) -> Vec<u8> {
    if is_intrinsic_error_type(ty) {
        return b"error typed".to_vec();
    }
    [&b"`"[..], ty.to_text().as_slice(), b"`"].concat()
}

fn describe_type_for_spread(ty: Type) -> Vec<u8> {
    if ty.is_array_type() && ty.get_type_arguments().first().is_some_and(is_intrinsic_error_type) {
        return b"error".to_vec();
    }
    describe_type(ty)
}

fn describe_type_for_tuple(ty: Type) -> Vec<u8> {
    if is_intrinsic_error_type(ty) {
        return b"error typed".to_vec();
    }
    [&b"of type `"[..], ty.to_text().as_slice(), b"`"].concat()
}

/// `node`: a call, a `new` or a tagged template, whose substitutions are the arguments.
fn check_unsafe_arguments<'a>(node: Expr<'a>, cx: &Cx<'a, NoUnsafeArgument>) {
    let (ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call)) = node.kind() else {
        return;
    };
    if call.args().is_empty() {
        return;
    }
    // A call of what is `any` is for `no-unsafe-call`.
    let callee_type = call.callee().ty();
    if is_type_any_type(callee_type) || callee_type.is_unresolved() {
        return;
    }

    let mut signature = FunctionSignature::create(node);
    if node.tag() == ExprTag::TaggedTemplate {
        // The first parameter is the `TemplateStringsArray`.
        signature.get_next_parameter_type();
    }

    for argument in call.args() {
        let ExprKind::Spread(spread_argument) = argument.kind() else {
            let Some(parameter_type) = signature.get_next_parameter_type() else {
                continue;
            };
            let argument_type = argument.ty();
            if is_unsafe_assignment(argument_type, parameter_type, argument).is_some() {
                cx.report(argument, UNSAFE_ARGUMENT)
                    .data("receiver", describe_type(parameter_type))
                    .data("sender", describe_type(argument_type));
            }
            continue;
        };

        let spread_arg_type = spread_argument.ty();
        if is_type_any_type(spread_arg_type) {
            cx.report(argument, UNSAFE_SPREAD).data("sender", describe_type(spread_arg_type));
        } else if is_type_any_array_type(spread_arg_type) {
            cx.report(argument, UNSAFE_ARRAY_SPREAD).data("sender", describe_type_for_spread(spread_arg_type));
        } else if spread_arg_type.is_tuple_type() {
            for tuple_type in spread_arg_type.get_type_arguments() {
                let Some(parameter_type) = signature.get_next_parameter_type() else {
                    continue;
                };
                // What is spread is most likely a variable, so there is no node for the element.
                if is_unsafe_assignment(tuple_type, parameter_type, None::<Expr<'a>>).is_some() {
                    cx.report(argument, UNSAFE_TUPLE_SPREAD)
                        .data("receiver", describe_type(parameter_type))
                        .data("sender", describe_type_for_tuple(tuple_type));
                }
            }
            // After a rest element, what follows is compared with the rest parameter, if there is one.
            if spread_arg_type.tuple_target().is_some_and(|target| target.has_rest_element()) {
                signature.consume_remaining_arguments();
            }
        }
    }
}

impl Rule for NoUnsafeArgument {
    const META: Meta = Meta::typescript("no-unsafe-argument", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnsafeArgument
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call, ExprTag::New, ExprTag::TaggedTemplate], |_, node, cx| {
            check_unsafe_arguments(node, cx);
        });
    }
}
