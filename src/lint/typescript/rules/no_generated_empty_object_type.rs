use bun_lint::prelude::*;
use bun_lint::types::tsutils::{is_object_flag_set, is_object_type};
use bun_lint::types::{ObjectFlags, Type};

/// Disallow type operations that resolve to the "empty object" type.
pub struct NoGeneratedEmptyObjectType;

const NO_GENERATED_EMPTY_OBJECT_TYPE: Message = Message::new(
    "noGeneratedEmptyObjectType",
    "This type resolves to `{}`, the empty object type. This was likely not intentional.",
);

fn is_empty_object_type(ty: Type) -> bool {
    let checker = ty.file().type_checker();
    is_object_type(ty)
        && !is_object_flag_set(ty, ObjectFlags::CLASS | ObjectFlags::INTERFACE)
        && ty.get_properties().is_empty()
        && ty.get_index_infos().len() == 0
        && ty.get_call_signatures().is_empty()
        && ty.get_construct_signatures().is_empty()
        // A type that still waits for type arguments, such as `Record<T, unknown>` in a generic
        // declaration, has no members yet either. Every primitive is assignable to `{}`. A mapped
        // type whose keys are not resolved, such as `{ [K in Keys<T>]: K }`, accepts `number` but
        // not `string`.
        && checker.get_number_type().is_assignable_to(ty)
        && checker.get_string_type().is_assignable_to(ty)
}

fn contains_empty_object_type(ty: Type) -> bool {
    is_empty_object_type(ty) || ty.is_union() && ty.types().iter().any(is_empty_object_type)
}

fn check_node<'a>(node: TypeNode<'a>, cx: &Cx<'a, NoGeneratedEmptyObjectType>) {
    if contains_empty_object_type(node.ty()) {
        cx.report(node, NO_GENERATED_EMPTY_OBJECT_TYPE);
    }
}

impl Rule for NoGeneratedEmptyObjectType {
    const META: Meta = Meta::typescript("no-generated-empty-object-type", Kind::Problem)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoGeneratedEmptyObjectType
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.types([TypeTag::Intersection], |_, node, cx| check_node(node, cx));
        on.types([TypeTag::Ref], |_, node, cx| {
            let TypeKind::Ref { args, .. } = node.kind() else {
                return;
            };
            if args.is_empty() {
                return;
            }
            let is_checked = match node.parent() {
                Node::Type(parent) => parent.tag() != TypeTag::Intersection,
                // What a class implements and what an interface extends is not a `TSTypeReference`.
                Node::Class(class) => !class.implements().iter().any(|it| it == node),
                Node::Stmt(parent) => parent.tag() != StmtTag::Interface,
                _ => true,
            };
            if is_checked {
                check_node(node, cx);
            }
        });
    }
}
