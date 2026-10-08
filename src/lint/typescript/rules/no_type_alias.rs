use bun_lint::prelude::*;
use smallvec::SmallVec;

/// Disallow type aliases.
pub struct NoTypeAlias {
    allow_aliases: Values,
    allow_callbacks: bool,
    allow_conditional_types: bool,
    allow_constructors: bool,
    allow_generics: bool,
    allow_literals: Values,
    allow_mapped_types: Values,
    allow_tuple_types: Values,
}

const NO_COMPOSITION_ALIAS: Message = Message::new(
    "noCompositionAlias",
    "{{typeName}} in {{compositionType}} types are not allowed.",
);
const NO_TYPE_ALIAS: Message = Message::new("noTypeAlias", "Type {{alias}} are not allowed.");

#[derive(Copy, Clone, PartialEq, Eq)]
enum Values {
    Always,
    Never,
    InUnions,
    InIntersections,
    InUnionsAndIntersections,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Composition {
    Union,
    Intersection,
}

#[derive(Copy, Clone)]
struct TypeWithLabel<'a> {
    node: TypeNode<'a>,
    composition_type: Option<Composition>,
}

/// Upstream's `aliasTypes.has(node.type)`.
fn is_alias_type(ty: TypeNode) -> bool {
    matches!(
        ty.kind(),
        TypeKind::Array(_)
            | TypeKind::Import { .. }
            | TypeKind::IndexedAccess { .. }
            | TypeKind::StringLit(_)
            | TypeKind::NumberLit(_)
            | TypeKind::BigIntLit { .. }
            | TypeKind::BoolLit(_)
            | TypeKind::Template(_)
            | TypeKind::Typeof { .. }
            | TypeKind::Ref { .. }
    )
}

fn is_tuple(ty: TypeNode) -> bool {
    ty.tag() == TypeTag::Tuple
}

/// Flattens `node` into the types that it is composed of.
fn get_types<'a>(
    node: TypeNode<'a>,
    composition_type: Option<Composition>,
    types: &mut SmallVec<[TypeWithLabel<'a>; 8]>,
) {
    let (parts, composition) = match node.kind() {
        TypeKind::Union(parts) => (parts, Composition::Union),
        TypeKind::Intersection(parts) => (parts, Composition::Intersection),
        _ => {
            return types.push(TypeWithLabel {
                node,
                composition_type,
            });
        }
    };
    for part in parts {
        get_types(part, Some(composition), types);
    }
}

fn report_error<'a>(cx: &Cx<'a, NoTypeAlias>, ty: TypeWithLabel<'a>, is_root: bool, label: &'static str) {
    if is_root {
        cx.report(ty.node, NO_TYPE_ALIAS).data("alias", label.to_ascii_lowercase());
        return;
    }
    cx.report(ty.node, NO_COMPOSITION_ALIAS)
        .data(
            "compositionType",
            match ty.composition_type {
                Some(Composition::Union) => "union",
                _ => "intersection",
            },
        )
        .data("typeName", label);
}

/// Whether `allowed` allows a type in that place.
fn is_allowed(allowed: Values, is_top_level: bool, composition_type: Option<Composition>) -> bool {
    match allowed {
        Values::Always => true,
        Values::Never => false,
        Values::InUnions => !is_top_level && composition_type == Some(Composition::Union),
        Values::InIntersections => !is_top_level && composition_type == Some(Composition::Intersection),
        Values::InUnionsAndIntersections => !is_top_level && composition_type.is_some(),
    }
}

impl NoTypeAlias {
    fn validate_type_aliases<'a>(&self, cx: &Cx<'a, Self>, ty: TypeWithLabel<'a>, is_top_level: bool) {
        let in_place = |allowed: Values| is_allowed(allowed, is_top_level, ty.composition_type);
        let (allowed, label) = match ty.node.kind() {
            TypeKind::Fn(func) if func.kind() == FnKind::ConstructorType => {
                (self.allow_constructors, "Constructors")
            }
            TypeKind::Fn(_) => (self.allow_callbacks, "Callbacks"),
            TypeKind::Cond { .. } => (self.allow_conditional_types, "Conditional types"),
            TypeKind::Object(_) => (in_place(self.allow_literals), "Literals"),
            TypeKind::Mapped(_) => (in_place(self.allow_mapped_types), "Mapped types"),
            TypeKind::Tuple(_) => (in_place(self.allow_tuple_types), "Tuple Types"),
            TypeKind::Keyof(operand) | TypeKind::Readonly(operand) if is_tuple(operand) => {
                (in_place(self.allow_tuple_types), "Tuple Types")
            }
            TypeKind::Ref { args, .. } if !args.is_empty() => (self.allow_generics, "Generics"),
            TypeKind::Keyword(Keyword::This) => (false, "Unhandled"),
            TypeKind::Keyword(_) | TypeKind::Keyof(_) => (in_place(self.allow_aliases), "Aliases"),
            TypeKind::Readonly(operand) if is_alias_type(operand) => (in_place(self.allow_aliases), "Aliases"),
            _ if is_alias_type(ty.node) => (in_place(self.allow_aliases), "Aliases"),
            _ => (false, "Unhandled"),
        };
        if !allowed {
            report_error(cx, ty, is_top_level, label);
        }
    }
}

impl Rule for NoTypeAlias {
    const META: Meta = Meta::typescript("no-type-alias", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let values = |key: &str| match object.str(key) {
            Some("always") => Values::Always,
            Some("in-unions") => Values::InUnions,
            Some("in-intersections") => Values::InIntersections,
            Some("in-unions-and-intersections") => Values::InUnionsAndIntersections,
            _ => Values::Never,
        };
        let is_always = |key: &str| object.str(key) == Some("always");
        NoTypeAlias {
            allow_aliases: values("allowAliases"),
            allow_callbacks: is_always("allowCallbacks"),
            allow_conditional_types: is_always("allowConditionalTypes"),
            allow_constructors: is_always("allowConstructors"),
            allow_generics: is_always("allowGenerics"),
            allow_literals: values("allowLiterals"),
            allow_mapped_types: values("allowMappedTypes"),
            allow_tuple_types: values("allowTupleTypes"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::TypeAlias], |rule, statement, cx| {
            let StmtKind::TypeAlias(alias) = statement.kind() else {
                return;
            };
            let mut types = SmallVec::new();
            get_types(alias.ty(), None, &mut types);
            let is_top_level = types.len() == 1;
            for ty in types {
                rule.validate_type_aliases(cx, ty, is_top_level);
            }
        });
    }
}
