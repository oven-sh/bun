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
    const ON: On = On::new().types(&[TypeTag::Ref]);
    type State<'a> = GlobalFunctions<'a>;

    fn new(_: &Options) -> Self {
        NoUnsafeFunctionType
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<GlobalFunctions<'a>> {
        file.mentions("Function").then(GlobalFunctions::default)
    }

    // Also what a class implements and what an interface extends.
    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if let TypeKind::Ref { name, .. } = ty.kind()
            && let Some(name) = name.as_ident()
            && name.name().is("Function")
            && is_reference_to_global(name.name(), ty, &mut cx.state)
        {
            cx.report(name, BANNED_FUNCTION_TYPE);
        }
    }
}
