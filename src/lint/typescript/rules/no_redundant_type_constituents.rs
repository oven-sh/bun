use bun_core::printer::json_stringify_alloc;
use bun_lint::prelude::*;
use bun_lint::types::tsutils::{is_false_literal_type, is_true_literal_type, union_constituents};
use bun_lint::types::{Literal, Type, TypeFlags};
use bun_lint::utils::ts_utils::is_function_or_function_type;
use smallvec::SmallVec;
use std::ops::Range;

/// Disallow members of unions and intersections that do nothing or override type information.
pub struct NoRedundantTypeConstituents;

const ERROR_TYPE_OVERRIDES: Message = Message::new(
    "errorTypeOverrides",
    "'{{typeName}}' is an 'error' type that acts as 'any' and overrides all other types in this {{container}} type.",
);
const LITERAL_OVERRIDDEN: Message = Message::new(
    "literalOverridden",
    "{{literal}} is overridden by {{primitive}} in this union type.",
);
const OVERRIDDEN: Message = Message::new(
    "overridden",
    "'{{typeName}}' is overridden by other types in this {{container}} type.",
);
const OVERRIDES: Message = Message::new(
    "overrides",
    "'{{typeName}}' overrides all other types in this {{container}} type.",
);
const PRIMITIVE_OVERRIDDEN: Message = Message::new(
    "primitiveOverridden",
    "{{primitive}} is overridden by the {{literal}} in this intersection type.",
);

/// `primitiveTypeFlags`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Primitive {
    BigInt,
    Boolean,
    Number,
    String,
}

impl Primitive {
    const ALL: [Primitive; 4] =
        [Primitive::BigInt, Primitive::Boolean, Primitive::Number, Primitive::String];

    fn flag(self) -> TypeFlags {
        match self {
            Primitive::BigInt => TypeFlags::BIG_INT,
            Primitive::Boolean => TypeFlags::BOOLEAN,
            Primitive::Number => TypeFlags::NUMBER,
            Primitive::String => TypeFlags::STRING,
        }
    }

    /// `primitiveTypeFlagNames`
    fn name(self) -> &'static str {
        match self {
            Primitive::BigInt => "bigint",
            Primitive::Boolean => "boolean",
            Primitive::Number => "number",
            Primitive::String => "string",
        }
    }

    /// `literalToPrimitiveTypeFlags[typeFlags]`
    fn of_literal(type_flags: TypeFlags) -> Option<Primitive> {
        if type_flags == TypeFlags::BIG_INT_LITERAL {
            Some(Primitive::BigInt)
        } else if type_flags == TypeFlags::BOOLEAN_LITERAL {
            Some(Primitive::Boolean)
        } else if type_flags == TypeFlags::NUMBER_LITERAL {
            Some(Primitive::Number)
        } else if type_flags == TypeFlags::STRING_LITERAL
            || type_flags == TypeFlags::TEMPLATE_LITERAL
        {
            Some(Primitive::String)
        } else {
            None
        }
    }
}

/// A set of [`Primitive`]s.
#[derive(Copy, Clone, Default)]
struct Primitives([bool; 4]);

impl Primitives {
    fn add(&mut self, primitive: Primitive) {
        self.0[primitive as usize] = true;
    }

    fn has(self, primitive: Primitive) -> bool {
        self.0[primitive as usize]
    }
}

/// What the `typeName` of a [`TypeFlagsWithName`] is made from, when it is reported.
#[derive(Copy, Clone)]
enum Described<'a> {
    TypeNode(TypeNode<'a>),
    Type(Type<'a>),
}

#[derive(Copy, Clone)]
struct TypeFlagsWithName<'a> {
    type_flags: TypeFlags,
    described: Described<'a>,
}

impl TypeFlagsWithName<'_> {
    fn type_name(self) -> Vec<u8> {
        match self.described {
            Described::TypeNode(type_node) => describe_literal_type_node(type_node),
            Described::Type(ty) => describe_literal_type(ty),
        }
    }
}

/// The constituents of a union or an intersection type as they are written, and for each which of
/// `parts` its type consists of.
#[derive(Default)]
struct Constituents<'a> {
    parts: SmallVec<[TypeFlagsWithName<'a>; 8]>,
    type_nodes: SmallVec<[(TypeNode<'a>, Range<usize>); 8]>,
}

impl<'a> Constituents<'a> {
    fn of(types: List<'a, TypeNode<'a>>) -> Self {
        let mut all = Constituents::default();
        for type_node in types {
            let start = all.parts.len();
            get_type_node_type_part_flags(type_node, &mut all.parts);
            all.type_nodes.push((type_node, start..all.parts.len()));
        }
        all
    }

    /// Each constituent with its parts.
    fn iter(&self) -> impl Iterator<Item = (TypeNode<'a>, &[TypeFlagsWithName<'a>])> {
        self.type_nodes.iter().map(|(type_node, range)| {
            (*type_node, self.parts.get(range.clone()).unwrap_or_default())
        })
    }
}

/// `names.join(' | ')`
fn join<'a>(parts: impl Iterator<Item = TypeFlagsWithName<'a>>) -> Vec<u8> {
    let mut joined = Vec::new();
    for (i, part) in parts.enumerate() {
        if i > 0 {
            joined.extend_from_slice(b" | ");
        }
        joined.extend_from_slice(&part.type_name());
    }
    joined
}

fn describe_literal_type(ty: Type) -> Vec<u8> {
    match ty.value() {
        Some(Literal::String(value)) => return json_stringify_alloc(value),
        Some(Literal::BigInt { negative, base10 }) => {
            let sign: &[u8] = if negative { b"-" } else { b"" };
            return [sign, base10, b"n"].concat();
        }
        Some(Literal::Number(value)) => return text::number_to_string(value),
        None => {}
    }
    // The alias of the type of a name that does not resolve is that name.
    if ty.is_error()
        && let Some(alias_symbol) = ty.alias_symbol()
    {
        return alias_symbol.escaped_name().to_vec();
    }
    let flags = ty.flags();
    let description: &[u8] = if flags.intersects(TypeFlags::ANY) {
        b"any"
    } else if flags.intersects(TypeFlags::NEVER) {
        b"never"
    } else if flags.intersects(TypeFlags::UNKNOWN) {
        b"unknown"
    } else if flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
        b"template literal type"
    } else if is_true_literal_type(ty) {
        b"true"
    } else if is_false_literal_type(ty) {
        b"false"
    } else {
        b"literal type"
    };
    description.to_vec()
}

fn describe_literal_type_node(type_node: TypeNode) -> Vec<u8> {
    let is_oxlint = type_node.file().language().is_oxlint;
    let description: &[u8] = match type_node.kind() {
        // tsgolint has a string without quotes, a template as it is written, and does not say which boolean it is.
        TypeKind::StringLit(value) if is_oxlint => return value.bytes().to_vec(),
        TypeKind::Template(_) if is_oxlint => return type_node.text().to_vec(),
        TypeKind::BoolLit(_) if is_oxlint => b"literal type",
        // One that does not resolve: `A.B<C, D>`.
        TypeKind::Ref { name, args } if is_oxlint => {
            let names: Vec<&[u8]> = name.parts().map(|it| it.bytes()).collect();
            let args: Vec<Vec<u8>> = args.iter().map(|it| it.ty().to_text()).collect();
            let mut text = names.join(&b"."[..]);
            if !args.is_empty() {
                text.push(b'<');
                text.extend_from_slice(&args.join(&b", "[..]));
                text.push(b'>');
            }
            return text;
        }
        TypeKind::Keyword(Keyword::Any) => b"any",
        TypeKind::Keyword(Keyword::Boolean) => b"boolean",
        TypeKind::Keyword(Keyword::Never) => b"never",
        TypeKind::Keyword(Keyword::Number) => b"number",
        TypeKind::Keyword(Keyword::String) => b"string",
        TypeKind::Keyword(Keyword::Unknown) => b"unknown",
        TypeKind::StringLit(value) => return json_stringify_alloc(value.bytes()),
        TypeKind::NumberLit(value) => return text::number_to_string(value),
        TypeKind::BoolLit(true) => b"true",
        TypeKind::BoolLit(false) => b"false",
        // In base 10.
        TypeKind::BigIntLit { .. } => return describe_literal_type(type_node.ty()),
        _ => b"literal type",
    };
    description.to_vec()
}

/// The reference to `name`, which does not resolve, that `type_node` has its type `error` from: itself, or the `A` of
/// `Partial<A>`.
fn unresolved_reference<'a>(mut type_node: TypeNode<'a>, error: Type<'a>, name: &[u8]) -> Option<TypeNode<'a>> {
    loop {
        let TypeKind::Ref { name: written, args } = type_node.kind() else {
            return None;
        };
        if written.last().is_some_and(|it| it.bytes() == name) {
            return Some(type_node);
        }
        type_node = args.iter().find(|it| it.ty() == error)?;
    }
}

/// Adds the parts of the type that is written as `type_node`.
fn get_type_node_type_part_flags<'a>(
    type_node: TypeNode<'a>,
    parts: &mut SmallVec<[TypeFlagsWithName<'a>; 8]>,
) {
    let type_flags = match type_node.kind() {
        TypeKind::Keyword(keyword) => match keyword {
            Keyword::Any => TypeFlags::ANY,
            Keyword::BigInt => TypeFlags::BIG_INT,
            Keyword::Boolean => TypeFlags::BOOLEAN,
            Keyword::Never => TypeFlags::NEVER,
            Keyword::Number => TypeFlags::NUMBER,
            Keyword::String => TypeFlags::STRING,
            Keyword::Unknown => TypeFlags::UNKNOWN,
            // One part, with none of the flags that are looked for.
            _ => TypeFlags::empty(),
        },
        TypeKind::StringLit(_) => TypeFlags::STRING_LITERAL,
        TypeKind::NumberLit(_) => TypeFlags::NUMBER_LITERAL,
        TypeKind::BigIntLit { .. } => TypeFlags::BIG_INT_LITERAL,
        TypeKind::BoolLit(_) => TypeFlags::BOOLEAN_LITERAL,
        // The same: an object type.
        TypeKind::Object(_)
        | TypeKind::Fn(_)
        | TypeKind::Array(_)
        | TypeKind::Tuple(_)
        | TypeKind::Mapped(_) => TypeFlags::empty(),
        // For tsgolint `(A | B)` is a `ParenthesizedType`, which it asks the type of.
        TypeKind::Union(types) if !(type_node.is_parenthesized() && type_node.file().language().is_oxlint) => {
            for type_node in types {
                get_type_node_type_part_flags(type_node, parts);
            }
            return;
        }
        _ => {
            let of_type = |type_part: Type<'a>| TypeFlagsWithName {
                type_flags: match type_part.is_unresolved() {
                    true => TypeFlags::empty(),
                    false => type_part.flags(),
                },
                described: Described::Type(type_part),
            };
            let node_type = type_node.ty();
            // tsgolint 7.0 names a type that does not resolve with what is before the dots and with its type arguments.
            if type_node.file().language().is_oxlint
                && node_type.is_error()
                && let Some(alias_symbol) = node_type.alias_symbol()
                && let Some(reference) = unresolved_reference(type_node, node_type, alias_symbol.escaped_name())
            {
                parts.push(TypeFlagsWithName {
                    type_flags: node_type.flags(),
                    described: Described::TypeNode(reference),
                });
                return;
            }
            // `unionTypePartsUnlessBoolean`: `boolean` is the union `false | true`.
            match node_type.has_flags(TypeFlags::BOOLEAN) {
                true => parts.push(of_type(node_type)),
                false => parts.extend(union_constituents(node_type).iter().map(of_type)),
            }
            return;
        }
    };
    parts.push(TypeFlagsWithName {
        type_flags,
        described: Described::TypeNode(type_node),
    });
}

fn is_node_inside_return_type(node: TypeNode) -> bool {
    matches!(node.parent(), Node::Func(func) if is_function_or_function_type(func))
}

/// Reports `any` or an error type among the constituents of a `container` type.
fn report_any<'a>(
    type_part: TypeFlagsWithName<'a>,
    type_node: TypeNode<'a>,
    container: &'static str,
    cx: &Cx<'a, NoRedundantTypeConstituents>,
) {
    let type_name = type_part.type_name();
    let message = if type_name == b"any" { OVERRIDES } else { ERROR_TYPE_OVERRIDES };
    cx.report(place(type_node), message).data("container", container).data("typeName", type_name);
}

/// oxlint points at the parentheses around a constituent.
fn place(type_node: TypeNode) -> Span {
    if type_node.file().language().is_oxlint { type_node.outer_span() } else { type_node.span() }
}

impl NoRedundantTypeConstituents {
    fn check_intersection<'a>(&self, node: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Intersection(types) = node.kind() else {
            return;
        };
        let constituents = Constituents::of(types);
        let (mut seen_literal_types, mut seen_primitive_types) =
            (Primitives::default(), Primitives::default());
        let mut has_seen_union_types = false;

        for (type_node, type_part_flags) in constituents.iter() {
            for &type_part in type_part_flags {
                let type_flags = type_part.type_flags;
                // `checkIntersectionBottomAndTopTypes`
                if type_flags == TypeFlags::ANY {
                    report_any(type_part, type_node, "intersection", cx);
                } else if type_flags == TypeFlags::NEVER || type_flags == TypeFlags::UNKNOWN {
                    let is_never = type_flags == TypeFlags::NEVER;
                    cx.report(place(type_node), if is_never { OVERRIDES } else { OVERRIDDEN })
                        .data("container", "intersection")
                        .data("typeName", type_part.type_name());
                } else if let Some(primitive) = Primitive::of_literal(type_flags) {
                    seen_literal_types.add(primitive);
                } else if let Some(primitive) =
                    Primitive::ALL.into_iter().find(|it| type_flags == it.flag())
                {
                    seen_primitive_types.add(primitive);
                }
            }
            // The type is a union.
            has_seen_union_types |= type_part_flags.len() >= 2;
        }

        // `type F = "a" | 2 | "b"; type I = F & string;`: whether all the members of `F` are
        // assignable to another constituent of `I`.
        if has_seen_union_types {
            for (type_ref, type_values) in constituents.iter() {
                if type_values.len() < 2 {
                    continue;
                }
                let primitive_of = |type_value: &TypeFlagsWithName| {
                    Primitive::of_literal(type_value.type_flags)
                        .filter(|&it| seen_primitive_types.has(it))
                };
                if let Some(primitive) = type_values.last().and_then(primitive_of)
                    && type_values.iter().all(|it| primitive_of(it).is_some())
                {
                    cx.report(place(type_ref), PRIMITIVE_OVERRIDDEN)
                        .data("literal", join(type_values.iter().copied()))
                        .data("primitive", primitive.name());
                }
            }
            return;
        }

        // Each primitive type that a literal type overrides.
        for primitive in Primitive::ALL {
            if !seen_primitive_types.has(primitive) || !seen_literal_types.has(primitive) {
                continue;
            }
            let matched_literal_types = constituents
                .parts
                .iter()
                .copied()
                .filter(|it| Primitive::of_literal(it.type_flags) == Some(primitive));
            let matched_literal_types = join(matched_literal_types);
            for (type_node, type_part_flags) in constituents.iter() {
                if !type_part_flags.iter().any(|it| it.type_flags == primitive.flag()) {
                    continue;
                }
                if cx.has_reported_too_much() {
                    return;
                }
                cx.report(place(type_node), PRIMITIVE_OVERRIDDEN)
                    .data("literal", matched_literal_types.clone())
                    .data("primitive", primitive.name());
            }
        }
    }

    fn check_union<'a>(&self, node: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Union(types) = node.kind() else {
            return;
        };
        let constituents = Constituents::of(types);
        // In the order in which they are seen: two of them can be reported at one constituent.
        let mut seen_literal_types = SmallVec::<[Primitive; 4]>::new();
        let mut seen_primitive_types = Primitives::default();

        for (type_node, type_part_flags) in constituents.iter() {
            for &type_part in type_part_flags {
                let type_flags = type_part.type_flags;
                // `checkUnionBottomAndTopTypes`
                if type_flags == TypeFlags::ANY {
                    report_any(type_part, type_node, "union", cx);
                } else if type_flags == TypeFlags::UNKNOWN {
                    cx.report(place(type_node), OVERRIDES)
                        .data("container", "union")
                        .data("typeName", type_part.type_name());
                } else if type_flags == TypeFlags::NEVER {
                    if !is_node_inside_return_type(node) {
                        cx.report(place(type_node), OVERRIDDEN)
                            .data("container", "union")
                            .data("typeName", "never");
                    }
                } else if let Some(primitive) = Primitive::of_literal(type_flags) {
                    if !seen_literal_types.contains(&primitive) {
                        seen_literal_types.push(primitive);
                    }
                } else {
                    for primitive in Primitive::ALL {
                        if type_flags.intersects(primitive.flag()) {
                            seen_primitive_types.add(primitive);
                        }
                    }
                }
            }
        }

        // For each constituent, the literal types in it that a primitive type overrides.
        for primitive in seen_literal_types {
            if !seen_primitive_types.has(primitive) {
                continue;
            }
            for (type_node, type_part_flags) in constituents.iter() {
                let is_overridden =
                    |it: &TypeFlagsWithName| Primitive::of_literal(it.type_flags) == Some(primitive);
                if type_part_flags.iter().any(is_overridden) {
                    cx.report(place(type_node), LITERAL_OVERRIDDEN)
                        .data("literal", join(type_part_flags.iter().copied().filter(is_overridden)))
                        .data("primitive", primitive.name());
                }
            }
        }
    }
}

impl Rule for NoRedundantTypeConstituents {
    const META: Meta = Meta::typescript("no-redundant-type-constituents", Kind::Suggestion)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types()
        .reports_on_exit();
    const ON: On = On::new().types(&[TypeTag::Intersection, TypeTag::Union]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoRedundantTypeConstituents
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        match ty.tag() {
            TypeTag::Intersection => self.check_intersection(ty, cx),
            TypeTag::Union => self.check_union(ty, cx),
            _ => {}
        }
    }
}
