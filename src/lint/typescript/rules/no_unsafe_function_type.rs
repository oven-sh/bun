use bun_lint::prelude::*;
use crate::rules::no_wrapper_object_types::{GlobalFunctions, is_reference_to_global};

/// Disallow using the unsafe built-in Function type.
pub struct NoUnsafeFunctionType;

const BANNED_FUNCTION_TYPE: Message = Message::new(
    "bannedFunctionType",
    "The `Function` type accepts any function-like value.\nPrefer explicitly defining any function parameters and return type.",
);

impl Rule for NoUnsafeFunctionType {
    const META: Meta = Meta::typescript("no-unsafe-function-type", Kind::Problem).recommended();
    type State<'a> = GlobalFunctions<'a>;

    fn new(_: &Options) -> Self {
        NoUnsafeFunctionType
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> GlobalFunctions<'a> {
        if !file.mentions("Function") {
            return GlobalFunctions::default();
        }
        // Also what a class implements and what an interface extends.
        on.types([TypeTag::Ref], |_, ty, cx| {
            if let TypeKind::Ref { name, .. } = ty.kind()
                && let Some(name) = name.as_ident()
                && name.name().is("Function")
                && is_reference_to_global(name.name(), ty, &mut cx.state)
            {
                cx.report(name, BANNED_FUNCTION_TYPE);
            }
        });
        GlobalFunctions::default()
    }
}
