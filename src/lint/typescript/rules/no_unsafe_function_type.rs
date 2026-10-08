use bun_lint::prelude::*;
use bun_lint::utils::ts_scope::is_reference_to_global_function;

/// Disallow using the unsafe built-in Function type.
pub struct NoUnsafeFunctionType;

const BANNED_FUNCTION_TYPE: Message = Message::new(
    "bannedFunctionType",
    "The `Function` type accepts any function-like value.\nPrefer explicitly defining any function parameters and return type.",
);

impl Rule for NoUnsafeFunctionType {
    const META: Meta = Meta::typescript("no-unsafe-function-type", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnsafeFunctionType
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        // Also what a class implements and what an interface extends.
        on.types([TypeTag::Ref], |_, ty, cx| {
            if let TypeKind::Ref { name, .. } = ty.kind()
                && let Some(name) = name.as_ident()
                && name.name().is("Function")
                && is_reference_to_global_function(name.name(), ty)
            {
                cx.report(name, BANNED_FUNCTION_TYPE);
            }
        });
    }
}
