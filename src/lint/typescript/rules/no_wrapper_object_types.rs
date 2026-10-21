use bun_lint::prelude::*;
use bun_lint::utils::ts_scope::is_reference_to_global_function;
use rustc_hash::FxHashMap;

/// Disallow using confusing built-in primitive class wrappers.
pub struct NoWrapperObjectTypes;

const BANNED_CLASS_TYPE: Message = Message::new(
    "bannedClassType",
    "Prefer using the primitive `{{preferred}}` as a type name, rather than the upper-cased `{{typeName}}`.",
);

/// Caches [`is_reference_to_global_function`]'s result per scope and name.
pub(crate) type GlobalFunctions<'a> = FxHashMap<(Scope<'a>, Name<'a>), bool>;

/// [`is_reference_to_global_function`], cached because it scans all of the scope's references.
pub(crate) fn is_reference_to_global<'a>(name: Name<'a>, ty: TypeNode<'a>, known: &mut GlobalFunctions<'a>) -> bool {
    *known.entry((Node::Type(ty).scope(), name)).or_insert_with(|| is_reference_to_global_function(name, ty))
}

/// True if it's in a class's `implements` or an interface's `extends` list, where a primitive isn't allowed.
fn is_heritage(ty: TypeNode<'_>) -> bool {
    match ty.parent() {
        // Only the type arguments of the `extends` clause come before the `implements` list.
        Node::Class(class) => class.implements().first().is_some_and(|first| first.span().start <= ty.span().start),
        Node::Stmt(statement) => statement.tag() == StmtTag::Interface,
        _ => false,
    }
}

impl Rule for NoWrapperObjectTypes {
    const META: Meta = Meta::typescript("no-wrapper-object-types", Kind::Problem)
        .fixable(Fixable::Code)
        .recommended();
    const ON: On = On::new().types(&[TypeTag::Ref]);
    type State<'a> = GlobalFunctions<'a>;

    fn new(_: &Options) -> Self {
        NoWrapperObjectTypes
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<GlobalFunctions<'a>> {
        if !file.mentions_any(&["BigInt", "Boolean", "Number", "Object", "String", "Symbol"]) {
            return None;
        }
        Some(GlobalFunctions::default())
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
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
        if !is_reference_to_global(name.name(), ty, &mut cx.state) {
            return;
        }
        cx.report(name, BANNED_CLASS_TYPE)
            .data("preferred", preferred)
            .data("typeName", name)
            // `Object` accepts a primitive and `object` doesn't, so `const a: object = 1` is an error.
            .fix_where_safe(
                || preferred != "object",
                |fixer| (!is_heritage(ty)).then(|| fixer.replace(name, preferred)),
            );
    }
}
