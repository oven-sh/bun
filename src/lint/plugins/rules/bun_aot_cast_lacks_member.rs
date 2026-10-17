use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::tsutils::{intersection_constituents, is_object_flag_set, union_constituents};
use bun_lint::types::utils::is_symbol_from_default_library;
use bun_lint::types::{ObjectFlags, SymbolFlags, Type, TypeFlags};
use rustc_hash::FxHashSet;

pub struct AotCastLacksMember;

const MISSING: Message = Message::new(
    "missing",
    "`{{member}}` is required in `{{type}}` and missing here. Under `--aot`, code that reads it throws a `TypeError`, where plain JavaScript reads `undefined`. Add it, or make it optional in the type.",
);
const WRONG_MEMBER: Message = Message::new(
    "wrongMember",
    "`{{member}}` is `{{wanted}}` in `{{type}}` and {{found}} here. Under `--aot`, code that reads it as `{{wanted}}` throws a `TypeError`. Give it a value of that type.",
);
const WRONG_VALUE: Message = Message::new(
    "wrongValue",
    "{{found}} is never a `{{type}}`. Under `--aot` this throws a `TypeError`, here or at the first place that expects a `{{type}}`. Build a real one, or change the type that is expected.",
);

mod kind {
    pub(super) const UNDEFINED: u16 = 1 << 0;
    pub(super) const NULL: u16 = 1 << 1;
    pub(super) const BOOLEAN: u16 = 1 << 2;
    pub(super) const NUMBER: u16 = 1 << 3;
    pub(super) const STRING: u16 = 1 << 4;
    pub(super) const BIGINT: u16 = 1 << 5;
    pub(super) const SYMBOL: u16 = 1 << 6;
    pub(super) const FUNCTION: u16 = 1 << 7;
    pub(super) const ARRAY: u16 = 1 << 8;
    pub(super) const OBJECT: u16 = 1 << 9;

    pub(super) const MISSING: u16 = UNDEFINED | NULL;
    pub(super) const OBJECTS: u16 = FUNCTION | ARRAY | OBJECT;
    pub(super) const PRIMITIVES: u16 = BOOLEAN | NUMBER | STRING | BIGINT | SYMBOL;
    pub(super) const ALL: u16 = (1 << 10) - 1;
}

fn kinds_of(ty: Type) -> u16 {
    let flags = ty.flags();
    if flags.intersects(TypeFlags::UNION) {
        return ty.types().iter().fold(0, |all, part| all | kinds_of(part));
    }
    if flags.intersects(TypeFlags::INTERSECTION) {
        let primitive = ty
            .types()
            .iter()
            .find(|part| part.has_flags(TypeFlags::PRIMITIVE));
        return primitive.map_or(kind::OBJECTS, kinds_of);
    }
    for (like, kinds) in [
        (TypeFlags::STRING_LIKE, kind::STRING),
        (TypeFlags::NUMBER_LIKE, kind::NUMBER),
        (TypeFlags::BOOLEAN_LIKE, kind::BOOLEAN),
        (TypeFlags::BIG_INT_LIKE, kind::BIGINT),
        (TypeFlags::ES_SYMBOL_LIKE, kind::SYMBOL),
        (TypeFlags::VOID_LIKE, kind::UNDEFINED),
        (TypeFlags::NULL, kind::NULL),
        (TypeFlags::NON_PRIMITIVE, kind::OBJECTS),
    ] {
        if flags.intersects(like) {
            return kinds;
        }
    }
    if !flags.intersects(TypeFlags::OBJECT) {
        return kind::ALL;
    }
    if ty.is_array_or_tuple_type() {
        return kind::ARRAY;
    }
    if !ty.get_call_signatures().is_empty() || !ty.get_construct_signatures().is_empty() {
        return kind::FUNCTION;
    }
    if is_object_flag_set(ty, ObjectFlags::OBJECT_LITERAL) {
        return kind::OBJECT;
    }
    match ty
        .symbol()
        .filter(|it| is_symbol_from_default_library(*it))
        .map(|it| it.name())
    {
        Some(b"Function") => kind::FUNCTION,
        Some(b"Object" | b"String" | b"Number" | b"Boolean" | b"BigInt" | b"Symbol") => {
            kind::ALL & !kind::MISSING
        }
        _ if ty.get_properties().is_empty() && ty.get_index_infos().len() == 0 => {
            kind::ALL & !kind::MISSING
        }
        _ => kind::OBJECTS,
    }
}

fn describe_kinds(kinds: u16) -> &'static str {
    match kinds {
        kind::UNDEFINED => "`undefined`",
        kind::NULL => "`null`",
        kind::BOOLEAN => "a boolean",
        kind::NUMBER => "a number",
        kind::STRING => "a string",
        kind::BIGINT => "a bigint",
        kind::SYMBOL => "a symbol",
        kind::FUNCTION => "a function",
        kind::ARRAY => "an array",
        kind::OBJECT => "an object literal",
        _ => "something else",
    }
}

fn is_kept_bare(ty: Type) -> bool {
    let parts = || {
        union_constituents(ty)
            .iter()
            .filter(|part| !part.has_flags(TypeFlags::NULLABLE))
    };
    let all = |like: TypeFlags| parts().all(|part| part.has_flags(like));
    parts().next().is_some() && (all(TypeFlags::NUMBER_LIKE) || all(TypeFlags::BOOLEAN_LIKE))
}

fn is_checked_cast_target(part: Type) -> bool {
    let is_object_structurally =
        part.has_flags(TypeFlags::OBJECT) && kinds_of(part) == kind::OBJECTS;
    !is_object_structurally
        || is_object_flag_set(part, ObjectFlags::MAPPED)
        || part.symbol().is_some_and(|symbol| {
            symbol
                .declarations()
                .any(|declaration| !declaration.get_source_file().is_declaration_file())
        })
}

fn is_class(ty: Type) -> bool {
    ty.symbol()
        .is_some_and(|it| it.has_flags(SymbolFlags::CLASS))
}

enum Mismatch<'a> {
    Missing(Type<'a>),
    WrongMember(Type<'a>, Type<'a>, Vec<u8>),
    WrongValue(Vec<u8>),
}

type Found<'a> = (Vec<u8>, Mismatch<'a>);

fn wrong_value<'a>(found: impl Into<Vec<u8>>) -> Option<Found<'a>> {
    Some((Vec::new(), Mismatch::WrongValue(found.into())))
}

fn below<'a>(
    name: &[u8],
    is_index: bool,
    found: Found<'a>,
    owner: Type<'a>,
    wanted: Type<'a>,
) -> Found<'a> {
    let (rest, mismatch) = found;
    let mut path = match is_index {
        true => [b"[", name, b"]"].concat(),
        false => name.to_vec(),
    };
    if !rest.is_empty() && !rest.starts_with(b"[") {
        path.push(b'.');
    }
    path.extend_from_slice(&rest);
    let mismatch = match mismatch {
        Mismatch::WrongValue(found) => Mismatch::WrongMember(owner, wanted, found),
        other => other,
    };
    (path, mismatch)
}

const LITERALS: &[ExprTag] = &[
    ExprTag::Object,
    ExprTag::Array,
    ExprTag::String,
    ExprTag::Template,
    ExprTag::Number,
    ExprTag::BigInt,
    ExprTag::True,
    ExprTag::False,
    ExprTag::Null,
];

fn literal_under_casts(e: Expr) -> Option<Expr> {
    let value = e.skip_type_wrappers();
    if LITERALS.contains(&value.tag()) || value.is_ident("undefined") {
        return Some(value);
    }
    let is_literal_type = |ty: Type| {
        ty.symbol()
            .is_some_and(|it| it.has_flags(SymbolFlags::OBJECT_LITERAL))
    };
    if value.tag() != ExprTag::Ident || !is_literal_type(value.ty()) {
        return None;
    }
    let symbol = value.symbol()?;
    if symbol.has_modifying_references() || symbol.declaration_count() != 1 {
        return None;
    }
    let Declaration::Var(pat) = symbol.declarations().next()? else {
        return None;
    };
    let Node::VarDecl(declaration) = Node::Pat(pat).parent() else {
        return None;
    };
    let starts_with = declaration
        .init()
        .filter(|it| it.tag() == ExprTag::Object)?;
    declaration.ty().is_none().then_some(starts_with)
}

fn literal_names<'a>(file: &'a File<'a>) -> FxHashSet<Name<'a>> {
    let literals = file.exprs_of_kind(ExprTag::Object);
    let names = literals.filter_map(|literal| match literal.parent() {
        Node::VarDecl(declaration) => match declaration.pat().kind() {
            PatKind::Ident(name) => Some(name),
            _ => None,
        },
        _ => None,
    });
    names.collect()
}

fn property_named<'a>(props: List<'a, Prop<'a>>, name: &[u8]) -> Option<Prop<'a>> {
    let is_it = |prop: &Prop<'a>| {
        prop.key()
            .and_then(Key::name)
            .is_some_and(|it| it.bytes() == name)
    };
    props.iter().filter(is_it).last()
}

fn object_mismatch<'a>(
    props: List<'a, Prop<'a>>,
    wanted: Type<'a>,
    depth: u32,
) -> Option<Found<'a>> {
    let is_allocated_by_cast = depth == 0 && !is_class(wanted);
    for member in wanted.get_properties().iter() {
        let name = member.name();
        if name.starts_with(b"__@") || name.starts_with(b"#") {
            continue;
        }
        let of_member = wanted.get_type_of_property(name);
        let Some(prop) = property_named(props, name) else {
            if member.has_flags(SymbolFlags::OPTIONAL) {
                continue;
            }
            if !is_allocated_by_cast {
                return wrong_value([b"an object literal without `", name, b"`"].concat());
            }
            if of_member.is_some_and(|it| is_kept_bare(it) && kinds_of(it) & kind::UNDEFINED == 0) {
                return Some((name.to_vec(), Mismatch::Missing(wanted)));
            }
            continue;
        };
        let Some(of_member) = of_member else {
            continue;
        };
        let found = match prop.kind() {
            PropKind::Init | PropKind::Shorthand => {
                prop.value().and_then(|it| mismatch(it, of_member, depth + 1))
            }
            PropKind::Method if kinds_of(of_member) & kind::FUNCTION == 0 => {
                wrong_value(describe_kinds(kind::FUNCTION))
            }
            _ => None,
        };
        if let Some(found) = found {
            return Some(below(name, false, found, wanted, of_member));
        }
    }
    None
}

fn mismatch<'a>(e: Expr<'a>, wanted: Type<'a>, depth: u32) -> Option<Found<'a>> {
    let value = literal_under_casts(e)?;
    let have = value.ty();
    if depth > 4 || have.has_flags(TypeFlags::ANY) || wanted.is_unresolved() {
        return None;
    }
    let (kinds, taken) = (kinds_of(have), kinds_of(wanted));
    if taken == kind::ALL
        || have.get_widened_type().is_assignable_to(wanted)
        || !union_constituents(wanted).iter().all(is_checked_cast_target)
    {
        return None;
    }
    if kinds & taken == 0 {
        let is_noop = match kinds & !kind::MISSING == 0 {
            true => depth == 0 || !is_kept_bare(wanted),
            false => depth == 0 && kinds & !kind::PRIMITIVES == 0 && taken & kind::PRIMITIVES != 0,
        };
        return if is_noop {
            None
        } else {
            wrong_value(describe_kinds(kinds))
        };
    }
    let is_open_type = |part: Type| {
        intersection_constituents(part)
            .iter()
            .any(|it| it.has_flags(TypeFlags::INSTANTIABLE))
    };
    match value.kind() {
        ExprKind::Object(props) => {
            let is_open = |prop: Prop| {
                prop.kind() == PropKind::Spread || prop.key().is_none_or(|it| it.name().is_none())
            };
            if depth == 0 && props.is_empty() || props.iter().any(is_open) {
                return None;
            }
            let mut first = None;
            for part in union_constituents(wanted)
                .iter()
                .filter(|part| kinds_of(*part) & kind::OBJECT != 0)
            {
                if is_open_type(part) {
                    return None;
                }
                let found = object_mismatch(props, part, depth)?;
                first = first.or(Some(found));
            }
            first
        }
        ExprKind::Array(elements) => {
            let mut parts = union_constituents(wanted)
                .iter()
                .filter(|part| kinds_of(*part) & kind::ARRAY != 0);
            let (Some(only), None) = (parts.next(), parts.next()) else {
                return None;
            };
            if only.is_array_type() {
                let of_elements = only.get_number_index_type()?;
                return elements.iter().enumerate().find_map(|(index, element)| {
                    let found = mismatch(element, of_elements, depth + 1)?;
                    Some(below(
                        index.to_string().as_bytes(),
                        true,
                        found,
                        only,
                        of_elements,
                    ))
                });
            }
            let is_object_structurally =
                depth > 0 && !only.is_tuple_type() && !is_open_type(only);
            if is_object_structurally {
                wrong_value(describe_kinds(kind::ARRAY))
            } else {
                None
            }
        }
        _ => None,
    }
}

impl Rule for AotCastLacksMember {
    const META: Meta =
        Meta::plugin(Plugin::Bun, "aot-cast-lacks-member", Kind::Problem).requires_types();
    const ON: On = On::new().exprs(&[ExprTag::As]);
    type State<'a> = Option<FxHashSet<Name<'a>>>;

    fn new(_: &Options) -> Self {
        AotCastLacksMember
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (!file.active_rule_overlaps().contains(bun_lint::language::RuleOverlaps::NO_UNSAFE_TYPE_ASSERTION)).then_some(None)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::As { expr, ty } = e.kind() else {
            return;
        };
        if let Some(name) = expr.skip_type_wrappers().as_ident() {
            let file = cx.file();
            let known = cx.state.get_or_insert_with(|| literal_names(file));
            if !known.contains(&name) && !name.is("undefined") {
                return;
            }
        }
        if literal_under_casts(expr).is_none() {
            return;
        }
        let asserted = ty.ty();
        let wanted = match asserted.has_flags(TypeFlags::NEVER) {
            true if matches!(e.parent(), Node::Expr(around) if around.skip_type_wrappers() != around) =>
            {
                return;
            }
            true => e.contextual_type(),
            false => Some(asserted),
        };
        let Some(wanted) = wanted else {
            return;
        };
        let Some((member, mismatch)) = mismatch(expr, wanted, 0) else {
            return;
        };
        match mismatch {
            Mismatch::Missing(owner) => cx
                .report(e, MISSING)
                .data("member", member)
                .data("type", owner.to_text()),
            Mismatch::WrongMember(owner, of_member, found) => cx
                .report(e, WRONG_MEMBER)
                .data("member", member)
                .data("wanted", of_member.to_text())
                .data("type", owner.to_text())
                .data("found", found),
            Mismatch::WrongValue(found) => {
                let mut found = found;
                if let Some(first) = found.first_mut() {
                    first.make_ascii_uppercase();
                }
                cx.report(e, WRONG_VALUE)
                    .data("found", found)
                    .data("type", wanted.to_text())
            }
        };
    }
}
