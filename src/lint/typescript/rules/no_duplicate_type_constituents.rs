use bun_lint::prelude::*;
use bun_lint::types::tsutils::is_intrinsic_error_type;
use bun_lint::types::{Type, TypeFlags};
use rustc_hash::{FxHashMap, FxHasher};
use smallvec::SmallVec;
use std::hash::{Hash, Hasher};

/// Disallow duplicate constituents of union or intersection types.
pub struct NoDuplicateTypeConstituents {
    ignore_intersections: bool,
    ignore_unions: bool,
}

const DUPLICATE: Message = Message::new(
    "duplicate",
    "{{type}} type constituent is duplicated with {{previous}}.",
);
const UNNECESSARY: Message = Message::new(
    "unnecessary",
    "Explicit undefined is unnecessary on an optional parameter.",
);

fn all_same<T: Copy>(
    mut a: impl Iterator<Item = T>,
    mut b: impl Iterator<Item = T>,
    is_same: fn(T, T) -> bool,
) -> bool {
    loop {
        match (a.next(), b.next()) {
            (None, None) => return true,
            (Some(a), Some(b)) if is_same(a, b) => {}
            _ => return false,
        }
    }
}

/// For the parts that are rarely written in two ways: the same but for whitespace and comments.
fn is_same_source<'a>(file: &'a File<'a>, a: Span, b: Span) -> bool {
    file.slice(a) == file.slice(b) || ast_utils::equal_tokens(file, a, b)
}

fn is_same_name<'a>(a: Ident<'a>, b: Ident<'a>) -> bool {
    a.name() == b.name()
}

fn is_same_type_param<'a>(a: TypeParam<'a>, b: TypeParam<'a>) -> bool {
    is_same_name(a.name(), b.name())
        && a.flags() == b.flags()
        && all_same(a.constraint().into_iter(), b.constraint().into_iter(), is_same_ast_node)
        && all_same(a.default().into_iter(), b.default().into_iter(), is_same_ast_node)
}

fn is_same_expr<'a>(a: Expr<'a>, b: Expr<'a>) -> bool {
    is_same_source(a.file(), a.span(), b.span())
}

fn is_same_key<'a>(file: &'a File<'a>, a: Option<Key<'a>>, b: Option<Key<'a>>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => is_same_source(file, a.span(file), b.span(file)),
        _ => false,
    }
}

fn is_same_pat_prop<'a>(a: PatProp<'a>, b: PatProp<'a>) -> bool {
    a.is_rest() == b.is_rest()
        && a.is_shorthand() == b.is_shorthand()
        && is_same_key(a.file(), a.key(), b.key())
        && is_same_pat(a.value(), b.value())
        && all_same(a.default().into_iter(), b.default().into_iter(), is_same_expr)
}

fn is_same_pat_elem<'a>(a: PatElem<'a>, b: PatElem<'a>) -> bool {
    a.is_rest() == b.is_rest()
        && all_same(a.pat().into_iter(), b.pat().into_iter(), is_same_pat)
        && all_same(a.default().into_iter(), b.default().into_iter(), is_same_expr)
}

fn is_same_pat<'a>(a: Pat<'a>, b: Pat<'a>) -> bool {
    match (a.kind(), b.kind()) {
        (PatKind::Missing, PatKind::Missing) => true,
        (PatKind::Ident(a), PatKind::Ident(b)) => a == b,
        (PatKind::Object(a), PatKind::Object(b)) => all_same(a.iter(), b.iter(), is_same_pat_prop),
        (PatKind::Array(a), PatKind::Array(b)) => all_same(a.iter(), b.iter(), is_same_pat_elem),
        _ => false,
    }
}

fn is_same_param<'a>(a: Param<'a>, b: Param<'a>) -> bool {
    a.flags() == b.flags()
        && is_same_pat(a.pat(), b.pat())
        && all_same(a.ty().into_iter(), b.ty().into_iter(), is_same_ast_node)
        && all_same(a.default().into_iter(), b.default().into_iter(), is_same_expr)
}

fn is_same_func<'a>(a: Func<'a>, b: Func<'a>) -> bool {
    a.kind() == b.kind()
        && a.flags() == b.flags()
        && all_same(a.type_params().iter(), b.type_params().iter(), is_same_type_param)
        && all_same(a.params_with_this(), b.params_with_this(), is_same_param)
        && all_same(a.return_type().into_iter(), b.return_type().into_iter(), is_same_ast_node)
}

fn is_same_member<'a>(a: Member<'a>, b: Member<'a>) -> bool {
    a.kind() == b.kind()
        && a.flags() == b.flags()
        && is_same_key(a.file(), a.key(), b.key())
        && all_same(a.ty().into_iter(), b.ty().into_iter(), is_same_ast_node)
        && all_same(a.func().into_iter(), b.func().into_iter(), is_same_func)
}

fn is_same_tuple_elem<'a>(a: TupleElem<'a>, b: TupleElem<'a>) -> bool {
    a.is_optional() == b.is_optional()
        && a.is_rest() == b.is_rest()
        && all_same(a.name().into_iter(), b.name().into_iter(), is_same_name)
        && is_same_ast_node(a.ty(), b.ty())
}

/// Upstream's `isSameAstNode`: the two are written the same, but for whitespace, comments,
/// parentheses and separators.
fn is_same_ast_node<'a>(mut a: TypeNode<'a>, mut b: TypeNode<'a>) -> bool {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return false;
    }
    // `T[][]` is as deep as it is long.
    loop {
        if a.tag() != b.tag() {
            return false;
        }
        if a.text() == b.text() {
            return true;
        }
        match (a.kind(), b.kind()) {
            (TypeKind::Array(operand_a), TypeKind::Array(operand_b))
            | (TypeKind::Keyof(operand_a), TypeKind::Keyof(operand_b))
            | (TypeKind::Readonly(operand_a), TypeKind::Readonly(operand_b)) => (a, b) = (operand_a, operand_b),
            _ => break,
        }
    }
    match (a.kind(), b.kind()) {
        (
            TypeKind::Ref { name, args },
            TypeKind::Ref {
                name: other_name,
                args: other_args,
            },
        ) => {
            all_same(name.parts(), other_name.parts(), is_same_name)
                && all_same(args.iter(), other_args.iter(), is_same_ast_node)
        }
        (TypeKind::Union(a), TypeKind::Union(b))
        | (TypeKind::Intersection(a), TypeKind::Intersection(b)) => {
            all_same(a.iter(), b.iter(), is_same_ast_node)
        }
        (TypeKind::Tuple(a), TypeKind::Tuple(b)) => all_same(a.iter(), b.iter(), is_same_tuple_elem),
        (TypeKind::Fn(a), TypeKind::Fn(b)) => is_same_func(a, b),
        (TypeKind::Object(a), TypeKind::Object(b)) => all_same(a.iter(), b.iter(), is_same_member),
        (
            TypeKind::Cond {
                check,
                extends,
                yes,
                no,
            },
            TypeKind::Cond {
                check: other_check,
                extends: other_extends,
                yes: other_yes,
                no: other_no,
            },
        ) => all_same(
            [check, extends, yes, no].into_iter(),
            [other_check, other_extends, other_yes, other_no].into_iter(),
            is_same_ast_node,
        ),
        (TypeKind::Infer(a), TypeKind::Infer(b)) => is_same_type_param(a, b),
        (TypeKind::Mapped(a), TypeKind::Mapped(b)) => {
            is_same_type_param(a.param(), b.param())
                && a.readonly() == b.readonly()
                && a.optional() == b.optional()
                && a.is_readonly_with_plus() == b.is_readonly_with_plus()
                && a.is_optional_with_plus() == b.is_optional_with_plus()
                && all_same(a.name_type().into_iter(), b.name_type().into_iter(), is_same_ast_node)
                && all_same(a.ty().into_iter(), b.ty().into_iter(), is_same_ast_node)
        }
        (
            TypeKind::IndexedAccess { obj, index },
            TypeKind::IndexedAccess {
                obj: other_obj,
                index: other_index,
            },
        ) => is_same_ast_node(obj, other_obj) && is_same_ast_node(index, other_index),
        (
            TypeKind::Predicate { param, ty, asserts },
            TypeKind::Predicate {
                param: other_param,
                ty: other_ty,
                asserts: other_asserts,
            },
        ) => {
            param == other_param
                && asserts == other_asserts
                && all_same(ty.into_iter(), other_ty.into_iter(), is_same_ast_node)
        }
        (TypeKind::Template(_), _) | (TypeKind::Typeof { .. }, _) | (TypeKind::Import { .. }, _) => {
            ast_utils::equal_tokens(a.file(), a, b)
        }
        // Keywords and literals, which are the same only if their text is.
        _ => false,
    }
}

/// Hashes `text`, of which [`is_same_source`] is asked, without its whitespace. `None` if there can be more to two such texts
/// than that: a comment, an escape, a character that is not ASCII.
fn hash_source(text: &[u8], hasher: &mut FxHasher) -> Option<()> {
    let mut previous = 0;
    for &byte in text {
        match byte {
            b'\\' | b'/' | 0x80.. => return None,
            // `<!--` and `-->` can start a comment.
            b'-' if previous == b'-' => return None,
            b'\t'..=b'\r' | b' ' => {}
            _ => hasher.write_u8(byte),
        }
        previous = byte;
    }
    hasher.write_u8(0xFF);
    Some(())
}

fn hash_func(func: Func, depth: u32, hasher: &mut FxHasher) -> Option<()> {
    for param in func.params_with_this() {
        hasher.write_u8(0xFF);
        if let Some(ty) = param.ty() {
            hash_ast_node(ty, depth, hasher)?;
        }
    }
    match func.return_type() {
        Some(return_type) => hash_ast_node(return_type, depth, hasher),
        None => Some(()),
    }
}

/// [`is_same_ast_node`] of a constituent and a later one. What the later one is a part of is not the same, and all that
/// is around a type that is nested deeply would be compared with it to the end.
fn is_repeated_by<'a>(earlier: TypeNode<'a>, later: TypeNode<'a>) -> bool {
    !earlier.span().contains(later.span()) && is_same_ast_node(earlier, later)
}

/// Hashes some of what two types have in common if [`is_same_ast_node`] holds for them.
fn hash_ast_node(mut node: TypeNode, depth: u32, hasher: &mut FxHasher) -> Option<()> {
    while let TypeKind::Array(operand) | TypeKind::Keyof(operand) | TypeKind::Readonly(operand) = node.kind() {
        node.tag().hash(hasher);
        node = operand;
    }
    node.tag().hash(hasher);
    if depth >= 16 {
        return Some(());
    }
    let depth = depth + 1;
    match node.kind() {
        TypeKind::Ref { name, args } => {
            for part in name.parts() {
                hasher.write(part.bytes());
                hasher.write_u8(0xFF);
            }
            for argument in args {
                hash_ast_node(argument, depth, hasher)?;
            }
        }
        TypeKind::Union(types) | TypeKind::Intersection(types) => {
            for ty in types {
                hash_ast_node(ty, depth, hasher)?;
            }
        }
        TypeKind::Tuple(elements) => {
            for element in elements {
                hash_ast_node(element.ty(), depth, hasher)?;
            }
        }
        TypeKind::Fn(func) => hash_func(func, depth, hasher)?,
        TypeKind::Object(members) => {
            let file = node.file();
            for member in members {
                if let Some(key) = member.key() {
                    hash_source(file.slice(key.span(file)), hasher)?;
                }
                if let Some(ty) = member.ty() {
                    hash_ast_node(ty, depth, hasher)?;
                }
                if let Some(func) = member.func() {
                    hash_func(func, depth, hasher)?;
                }
            }
        }
        TypeKind::Cond {
            check,
            extends,
            yes,
            no,
        } => {
            for ty in [check, extends, yes, no] {
                hash_ast_node(ty, depth, hasher)?;
            }
        }
        TypeKind::IndexedAccess { obj, index } => {
            hash_ast_node(obj, depth, hasher)?;
            hash_ast_node(index, depth, hasher)?;
        }
        TypeKind::Template(_) | TypeKind::Typeof { .. } | TypeKind::Import { .. } => hash_source(node.text(), hasher)?,
        // The same only if their text is.
        TypeKind::Keyword(_)
        | TypeKind::StringLit(_)
        | TypeKind::NumberLit(_)
        | TypeKind::BigIntLit { .. }
        | TypeKind::BoolLit(_) => hasher.write(node.text()),
        _ => {}
    }
    Some(())
}

/// A number that is the same for two types for which [`is_same_ast_node`] holds. `None`: whether it holds for this type and
/// another takes a comparison.
fn fingerprint(node: TypeNode) -> Option<u64> {
    let mut hasher = FxHasher::default();
    hash_ast_node(node, 0, &mut hasher)?;
    Some(hasher.finish())
}

/// `previous`: for [`DUPLICATE`], `Union` or `Intersection` and the constituent that it repeats.
fn report<'a>(
    cx: &Cx<'a, NoDuplicateTypeConstituents>,
    message: Message,
    constituent_node: TypeNode<'a>,
    previous: Option<(&'static str, TypeNode<'a>)>,
) {
    let file = cx.file();
    let parent = constituent_node.parent().span();
    let is_union_or_intersection_token =
        |token: &Token<'a>| (token.is("&") || token.is("|")) && parent.contains(token.span());

    // The `|` or `&` and the parentheses around the constituent, which go with it.
    let mut removed: SmallVec<[Span; 8]> = SmallVec::new();
    removed.push(constituent_node.span());
    let before_union_or_intersection_token = file
        .tokens_before(constituent_node)
        .take_while(|token| token.start() >= parent.start)
        .find(is_union_or_intersection_token);
    let (bracket_before_tokens, bracket_after_tokens) = match before_union_or_intersection_token {
        Some(before) => {
            removed.push(before.span());
            let bracket_before_tokens = file.tokens_between(before, constituent_node);
            let count = bracket_before_tokens.len();
            (bracket_before_tokens.take(count), file.tokens_after(constituent_node).take(count))
        }
        None => {
            let after_union_or_intersection_token = file
                .tokens_after(constituent_node)
                .take_while(|token| token.end() <= parent.end)
                .find(is_union_or_intersection_token);
            let Some(after) = after_union_or_intersection_token else {
                return;
            };
            removed.push(after.span());
            let bracket_after_tokens = file.tokens_between(constituent_node, after);
            let count = bracket_after_tokens.len();
            (file.tokens_before(constituent_node).take(count), bracket_after_tokens.take(count))
        }
    };
    let mut end = constituent_node.span().end;
    removed.extend(bracket_before_tokens.map(|token| token.span()));
    for token in bracket_after_tokens {
        end = token.end();
        removed.push(token.span());
    }

    // oxlint points at the first of the two.
    let place = match previous.filter(|_| cx.language().is_oxlint) {
        Some((_, previous)) => previous.span(),
        None => Span::new(constituent_node.span().start, end),
    };
    let mut report = cx.report(place, message);
    if let Some((union_or_intersection, previous)) = previous {
        report = report.data("type", union_or_intersection).data("previous", previous.text());
    }
    report.fix(|fixer| removed.iter().map(|&span| fixer.remove(span)).collect::<Vec<Fix>>());
}

/// The name of a type that is nothing but a name.
fn as_plain_name(node: TypeNode<'_>) -> Option<Ident<'_>> {
    match node.kind() {
        TypeKind::Ref { name, args } if name.len() == 1 && args.is_empty() => name.get(0),
        _ => None,
    }
}

/// Whether [`Index::key`] tells `node` from everything that is not the same for
/// [`is_same_ast_node`].
fn is_plain(node: TypeNode) -> bool {
    matches!(
        node.tag(),
        TypeTag::Keyword
            | TypeTag::StringLit
            | TypeTag::NumberLit
            | TypeTag::BigIntLit
            | TypeTag::BoolLit
            | TypeTag::UniqueSymbol
    ) || as_plain_name(node).is_some()
}

/// The constituents of a union of many, which is not searched one by one.
#[derive(Default)]
struct Index<'a> {
    by_key: FxHashMap<(TypeTag, &'a [u8]), TypeNode<'a>>,
    by_type: FxHashMap<Type<'a>, TypeNode<'a>>,
    /// Those that are not [plain](is_plain).
    not_plain: Vec<TypeNode<'a>>,
    /// The same, by their [`fingerprint`].
    by_fingerprint: FxHashMap<u64, SmallVec<[TypeNode<'a>; 1]>>,
    without_fingerprint: Vec<TypeNode<'a>>,
}

impl<'a> Index<'a> {
    /// Two with the same key are the same for [`is_same_ast_node`].
    fn key(node: TypeNode<'a>) -> (TypeTag, &'a [u8]) {
        (node.tag(), as_plain_name(node).map_or_else(|| node.text(), Ident::bytes))
    }

    fn insert(&mut self, node: TypeNode<'a>, ty: Type<'a>) {
        self.by_key.insert(Self::key(node), node);
        self.by_type.insert(ty, node);
        if !is_plain(node) {
            self.not_plain.push(node);
            match fingerprint(node) {
                Some(fingerprint) => self.by_fingerprint.entry(fingerprint).or_default().push(node),
                None => self.without_fingerprint.push(node),
            }
        }
    }

    /// The one that is not [plain](is_plain) and the same as `node`. No two of them are the same.
    fn find_not_plain(&self, node: TypeNode<'a>) -> Option<TypeNode<'a>> {
        let is_same = |it: &TypeNode<'a>| is_repeated_by(*it, node);
        if is_plain(node) {
            return None;
        }
        let Some(fingerprint) = fingerprint(node) else {
            return self.not_plain.iter().copied().find(is_same);
        };
        let with_the_same = self.by_fingerprint.get(&fingerprint).map(|it| it.as_slice()).unwrap_or_default();
        with_the_same.iter().chain(&self.without_fingerprint).copied().find(is_same)
    }
}

struct Constituents<'a> {
    /// `Union` or `Intersection`
    tag: TypeTag,
    /// The union is the type of an optional parameter.
    is_of_optional_parameter: bool,
    /// Upstream's `uniqueConstituents` and `cachedTypeMap`, while they are few.
    unique: SmallVec<[(TypeNode<'a>, Type<'a>); 8]>,
    index: Option<Box<Index<'a>>>,
}

impl<'a> Constituents<'a> {
    const MANY: usize = 32;

    fn find_same_ast_node(&self, node: TypeNode<'a>) -> Option<TypeNode<'a>> {
        let is_same = |it: &TypeNode<'a>| is_repeated_by(*it, node);
        match &self.index {
            None => self.unique.iter().map(|it| it.0).find(is_same),
            Some(index) => {
                let same_key = index.by_key.get(&Index::key(node)).copied();
                same_key.or_else(|| index.find_not_plain(node))
            }
        }
    }

    fn find_same_type(&self, ty: Type<'a>) -> Option<TypeNode<'a>> {
        match &self.index {
            None => self.unique.iter().find(|it| it.1 == ty).map(|it| it.0),
            Some(index) => index.by_type.get(&ty).copied(),
        }
    }

    fn push(&mut self, node: TypeNode<'a>, ty: Type<'a>) {
        if let Some(index) = &mut self.index {
            index.insert(node, ty);
            return;
        }
        self.unique.push((node, ty));
        if self.unique.len() == Self::MANY {
            let mut index = Box::<Index<'a>>::default();
            for (node, ty) in self.unique.drain(..) {
                index.insert(node, ty);
            }
            self.index = Some(index);
        }
    }

    fn check_duplicate_recursively(
        &mut self,
        constituent_node: TypeNode<'a>,
        cx: &Cx<'a, NoDuplicateTypeConstituents>,
    ) {
        let union_or_intersection = match self.tag {
            TypeTag::Intersection => "Intersection",
            _ => "Union",
        };
        let report_duplicate = |previous: TypeNode<'a>| {
            report(cx, DUPLICATE, constituent_node, Some((union_or_intersection, previous)));
        };

        // The syntax is compared first, which is cheaper than to ask for the type.
        if let Some(previous) = self.find_same_ast_node(constituent_node) {
            report_duplicate(previous);
            return;
        }
        let ty = constituent_node.ty();
        if is_intrinsic_error_type(ty) || ty.is_unresolved() {
            return;
        }
        if let Some(previous) = self.find_same_type(ty) {
            report_duplicate(previous);
            return;
        }

        if self.is_of_optional_parameter && ty.has_flags(TypeFlags::UNDEFINED) {
            report(cx, UNNECESSARY, constituent_node, None);
        }
        self.push(constituent_node, ty);

        if constituent_node.tag() == self.tag
            && let TypeKind::Union(types) | TypeKind::Intersection(types) = constituent_node.kind()
        {
            for constituent in types {
                self.check_duplicate_recursively(constituent, cx);
            }
        }
    }
}

impl NoDuplicateTypeConstituents {
    fn check_duplicate<'a>(&self, node: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let (TypeKind::Union(types) | TypeKind::Intersection(types)) = node.kind() else {
            return;
        };
        let (tag, parent) = (node.tag(), node.parent());
        if matches!(parent, Node::Type(parent) if parent.tag() == tag) {
            return;
        }
        let is_of_optional_parameter = tag == TypeTag::Union
            && matches!(parent, Node::Param(param) if param.is_optional()
                && param.pat().tag() == PatTag::Ident
                && !param.is_rest()
                && !param.is_parameter_property()
                && param.default().is_none()
                && param.func().is_some_and(|func| func.kind() != FnKind::IndexSignature));
        let mut constituents = Constituents {
            tag,
            is_of_optional_parameter,
            unique: SmallVec::new(),
            index: None,
        };
        for ty in types {
            constituents.check_duplicate_recursively(ty, cx);
        }
    }
}

impl Rule for NoDuplicateTypeConstituents {
    const META: Meta = Meta::typescript("no-duplicate-type-constituents", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoDuplicateTypeConstituents {
            ignore_intersections: options.bool_or("ignoreIntersections", false),
            ignore_unions: options.bool_or("ignoreUnions", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if !self.ignore_intersections {
            on.types([TypeTag::Intersection], Self::check_duplicate);
        }
        if !self.ignore_unions {
            on.types([TypeTag::Union], Self::check_duplicate);
        }
    }
}
