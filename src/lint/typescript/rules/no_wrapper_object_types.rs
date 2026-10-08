use bun_lint::prelude::*;
use bun_lint::utils::ts_scope::is_reference_to_global_function;

/// Disallow using confusing built-in primitive class wrappers.
pub struct NoWrapperObjectTypes;

const BANNED_CLASS_TYPE: Message = Message::new(
    "bannedClassType",
    "Prefer using the primitive `{{preferred}}` as a type name, rather than the upper-cased `{{typeName}}`.",
);

/// It is what a class implements or what an interface extends, where a primitive cannot be.
fn is_heritage(ty: TypeNode<'_>) -> bool {
    match ty.parent() {
        Node::Class(class) => class.implements().iter().any(|it| it == ty),
        Node::Stmt(statement) => statement.tag() == StmtTag::Interface,
        _ => false,
    }
}

impl Rule for NoWrapperObjectTypes {
    const META: Meta = Meta::typescript("no-wrapper-object-types", Kind::Problem)
        .fixable(Fixable::Code)
        .recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoWrapperObjectTypes
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.types([TypeTag::Ref], |_, ty, cx| {
            let TypeKind::Ref { name, .. } = ty.kind() else {
                return;
            };
            let Some(name) = name.as_ident() else {
                return;
            };
            let preferred = match name.bytes() {
                b"BigInt" => "bigint",
                b"Boolean" => "boolean",
                b"Number" => "number",
                b"Object" => "object",
                b"String" => "string",
                b"Symbol" => "symbol",
                _ => return,
            };
            if !is_reference_to_global_function(name.name(), ty) {
                return;
            }
            cx.report(name, BANNED_CLASS_TYPE)
                .data("preferred", preferred)
                .data("typeName", name)
                .fix(|fixer| (!is_heritage(ty)).then(|| fixer.replace(name, preferred)));
        });
    }
}
