use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::utils::{
    get_constrained_type_at_location, get_type_name, is_symbol_from_default_library, matches_type_or_base_type,
};
use bun_lint::types::{SyntaxKind, TsNode, Type, TypeFlags, tsutils};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// Require `.toString()` and `.toLocaleString()` to only be called on objects which provide useful information when stringified.
pub struct NoBaseToString {
    ignored_type_names: Vec<Vec<u8>>,
    /// One of them has a `[`.
    ignores_name_with_bracket: bool,
    check_unknown: bool,
}

const BASE_ARRAY_JOIN: Message = Message::new(
    "baseArrayJoin",
    "Using `join()` for {{name}} {{certainty}} use Object's default stringification format ('[object Object]') when stringified.",
);
const BASE_TO_STRING: Message = Message::new(
    "baseToString",
    "'{{name}}' {{certainty}} use Object's default stringification format ('[object Object]') when stringified.",
);

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Usefulness {
    Always,
    Never,
    Sometimes,
}

/// What is kept while the certainty of one expression is collected.
#[derive(Default)]
struct Walk<'a> {
    /// The array and tuple types that are being looked into.
    visited: SmallVec<[Type<'a>; 4]>,
    /// The array and tuple types that [`NoBaseToString::is_always_on_every_path`] was asked about.
    is_always: FxHashMap<Type<'a>, bool>,
    /// While it is asked: the array and tuple types that it has come across.
    assumed: Option<FxHashSet<Type<'a>>>,
    /// Those of them that are still to be looked into.
    pending: Vec<Type<'a>>,
    /// The one that is looked into.
    looked_into: Option<Type<'a>>,
    /// Each of them that has been come across, with the one in which.
    come_across: Vec<(Type<'a>, Option<Type<'a>>)>,
    /// Since that one was begun with, something was not [`Usefulness::Always`].
    found_other: bool,
    /// What has been found for an array or tuple type, if it does not depend on what was in `visited`. Otherwise a `[T, T]` of a
    /// `[U, U]` of .. is looked into two to the power of the depth times.
    known: FxHashMap<Type<'a>, Known>,
    /// The first of `visited` that has been come across again, since the type that is looked into was begun with.
    first_revisited: Option<usize>,
    /// Since then, something was deeper than [`MAX_DEPTH`].
    was_cut_off: bool,
}

#[derive(Copy, Clone)]
struct Known {
    certainty: Usefulness,
    depth: u32,
    was_cut_off: bool,
}

/// What has been found for the type of an expression, and whether that was for `join()`.
type Certainties<'a> = FxHashMap<(Type<'a>, bool), Usefulness>;

/// Upstream has no bound.
const MAX_DEPTH: u32 = 100;

/// `getTypeName(checker, type) === 'string'`
fn has_type_name_string(ty: Type) -> bool {
    let flags = ty.flags();
    flags.intersects(TypeFlags::STRING_LIKE)
        || flags.intersects(TypeFlags::TYPE_PARAMETER | TypeFlags::UNION_OR_INTERSECTION) && get_type_name(ty) == b"string"
}

/// ESTree's `Literal`
fn is_literal(node: Expr) -> bool {
    matches!(
        node.tag(),
        ExprTag::String
            | ExprTag::Number
            | ExprTag::BigInt
            | ExprTag::Regex
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Null
    )
}

fn collect_union_type_certainty<'a>(
    ty: Type<'a>,
    mut collect_sub_type_certainty: impl FnMut(Type<'a>) -> Usefulness,
) -> Usefulness {
    let (mut is_never, mut is_always) = (true, true);
    for t in ty.types() {
        match collect_sub_type_certainty(t) {
            Usefulness::Never => is_always = false,
            Usefulness::Always => is_never = false,
            Usefulness::Sometimes => return Usefulness::Sometimes,
        }
    }
    match (is_never, is_always) {
        (true, _) => Usefulness::Never,
        (false, true) => Usefulness::Always,
        (false, false) => Usefulness::Sometimes,
    }
}

fn collect_intersection_type_certainty<'a>(
    ty: Type<'a>,
    mut collect_sub_type_certainty: impl FnMut(Type<'a>) -> Usefulness,
) -> Usefulness {
    match ty.types().iter().any(|sub_type| collect_sub_type_certainty(sub_type) == Usefulness::Always) {
        true => Usefulness::Always,
        false => Usefulness::Never,
    }
}

/// `[Symbol.toPrimitive](): T` in an interface or a type literal.
fn is_symbol_to_primitive_method(node: TsNode) -> bool {
    if node.kind() != SyntaxKind::MethodSignature {
        return false;
    }
    let Some(access) = node
        .name()
        .filter(|name| name.kind() == SyntaxKind::ComputedPropertyName)
        .and_then(|name| name.expression())
        .filter(|expression| expression.kind() == SyntaxKind::PropertyAccessExpression)
    else {
        return false;
    };
    let (Some(object), Some(name)) = (access.expression(), access.name()) else {
        return false;
    };
    object.kind() == SyntaxKind::Identifier
        && object.text() == b"Symbol"
        && name.kind() == SyntaxKind::Identifier
        && name.text() == b"toPrimitive"
        && is_symbol_from_default_library(object.get_symbol_at_location())
}

/// It is a member of `interface Object`.
fn is_declared_on_object(declaration: TsNode) -> bool {
    declaration.parent().is_some_and(|parent| {
        parent.kind() == SyntaxKind::InterfaceDeclaration && parent.name().is_some_and(|name| name.text() == b"Object")
    })
}

/// `None`: the type has none of the methods.
fn is_to_string_like_from_object(ty: Type) -> Option<bool> {
    // An explicit `[Symbol.toPrimitive]` declaration is always user-defined.
    if tsutils::get_well_known_symbol_property_of_type(ty, "toPrimitive")
        .and_then(|property| property.value_declaration())
        .is_some_and(is_symbol_to_primitive_method)
    {
        return Some(false);
    }
    // Otherwise one of the methods that type coercion uses which is not declared on `Object` itself.
    let mut found_fallback_on_object = false;
    for property_name in ["toLocaleString", "toString", "valueOf"] {
        let Some(candidate) = ty.get_property(property_name.as_bytes()) else {
            continue;
        };
        let mut declarations = candidate.declarations().peekable();
        if declarations.peek().is_none() {
            continue;
        }
        if !declarations.all(is_declared_on_object) {
            return Some(false);
        }
        found_fallback_on_object = true;
    }
    found_fallback_on_object.then_some(true)
}

impl NoBaseToString {
    fn is_ignored(&self, name: &[u8]) -> bool {
        self.ignored_type_names.iter().any(|it| it == name)
    }

    /// `ignoredTypeNames.includes(getTypeName(checker, type))`
    fn has_ignored_name(&self, ty: Type) -> bool {
        // The text of an array or a tuple type that has no name of its own has a `[`. It has the text of all the types
        // in it, which is made again for each of them.
        let has_bracket = || ty.alias_symbol().is_none() && (ty.is_tuple_type() || ty.is_array_type());
        (self.ignores_name_with_bracket || !has_bracket()) && self.is_ignored(&get_type_name(ty))
    }

    fn collect_tuple_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>, depth: u32) -> Usefulness {
        let mut certainty = Usefulness::Always;
        for t in ty.get_type_arguments() {
            match self.collect_to_string_certainty(t, walk, depth) {
                Usefulness::Never => return Usefulness::Never,
                Usefulness::Sometimes => certainty = Usefulness::Sometimes,
                Usefulness::Always => {}
            }
        }
        certainty
    }

    fn collect_array_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>, depth: u32) -> Usefulness {
        match ty.get_number_index_type() {
            Some(elem_type) => self.collect_to_string_certainty(elem_type, walk, depth),
            None => Usefulness::Always,
        }
    }

    fn collect_elements_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>, depth: u32) -> Usefulness {
        match ty.is_tuple_type() {
            true => self.collect_tuple_certainty(ty, walk, depth),
            false => self.collect_array_certainty(ty, walk, depth),
        }
    }

    fn collect_join_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>, depth: u32) -> Usefulness {
        if depth > MAX_DEPTH {
            return Usefulness::Always;
        }
        let depth = depth + 1;
        if ty.is_union() {
            return collect_union_type_certainty(ty, |t| self.collect_join_certainty(t, walk, depth));
        }
        if ty.is_intersection() {
            return collect_intersection_type_certainty(ty, |t| self.collect_join_certainty(t, walk, depth));
        }
        if ty.is_tuple_type() {
            return self.collect_tuple_certainty(ty, walk, depth);
        }
        if ty.is_array_type() {
            return self.collect_array_certainty(ty, walk, depth);
        }
        Usefulness::Always
    }

    /// Whether the array or tuple type `ty` is `Always` whatever is in `visited`.
    ///
    /// Upstream looks into the types of a cycle once for every path that leads to them, which does
    /// not end where a dozen of them refer to each other. This looks into every type once and takes
    /// those inside it for `Always`. If nothing else turns up, every path finds the same.
    ///
    /// The answer is kept for all the types that it has come across, not to look into what is left of a chain of them
    /// from each of its links.
    fn is_always_on_every_path<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>, depth: u32) -> bool {
        let mut assumed = FxHashSet::default();
        assumed.insert(ty);
        walk.assumed = Some(assumed);
        walk.pending.push(ty);
        let mut others = Vec::new();
        while let Some(t) = walk.pending.pop() {
            walk.looked_into = Some(t);
            walk.found_other = false;
            self.collect_elements_certainty(t, walk, depth);
            if walk.found_other {
                others.push(t);
            }
        }
        let assumed = walk.assumed.take().unwrap_or_default();
        let come_across = std::mem::take(&mut walk.come_across);
        if others.is_empty() {
            walk.is_always.extend(assumed.into_iter().map(|t| (t, true)));
            return true;
        }
        // All that one of `others` is in, however deep.
        let mut around: FxHashMap<Type<'a>, SmallVec<[Type<'a>; 1]>> = FxHashMap::default();
        for (inner, outer) in come_across {
            around.entry(inner).or_default().extend(outer);
        }
        let mut has_other: FxHashSet<Type<'a>> = others.iter().copied().collect();
        while let Some(t) = others.pop() {
            for &outer in around.get(&t).map(|it| it.as_slice()).unwrap_or_default() {
                if has_other.insert(outer) {
                    others.push(outer);
                }
            }
        }
        walk.is_always.extend(assumed.into_iter().map(|t| (t, !has_other.contains(&t))));
        false
    }

    fn collect_to_string_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>, depth: u32) -> Usefulness {
        let certainty = self.to_string_certainty(ty, walk, depth);
        walk.found_other |= certainty != Usefulness::Always;
        certainty
    }

    fn to_string_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>, depth: u32) -> Usefulness {
        if depth > MAX_DEPTH {
            walk.found_other = true;
            walk.was_cut_off = true;
            return Usefulness::Always;
        }
        // A self referencing array or tuple type is not reported.
        if walk.assumed.is_none()
            && let Some(revisited) = walk.visited.iter().position(|it| *it == ty)
        {
            walk.first_revisited = Some(walk.first_revisited.map_or(revisited, |first| first.min(revisited)));
            return Usefulness::Always;
        }
        let depth = depth + 1;
        let flags = ty.flags();

        // All that follows finds this for them.
        if flags.intersects(TypeFlags::PRIMITIVE | TypeFlags::ANY | TypeFlags::NEVER) {
            return Usefulness::Always;
        }

        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return match ty.get_constraint() {
                Some(constraint) => self.collect_to_string_certainty(constraint, walk, depth),
                // An unconstrained generic means `unknown`.
                None if self.check_unknown => Usefulness::Sometimes,
                None => Usefulness::Always,
            };
        }

        if !self.ignored_type_names.is_empty() {
            if let Some(symbol) = ty.alias_symbol().or_else(|| ty.get_symbol())
                && self.is_ignored(symbol.name())
                && let Some(decl) = symbol.declarations().next()
                && matches!(
                    decl.kind(),
                    SyntaxKind::TypeAliasDeclaration | SyntaxKind::InterfaceDeclaration | SyntaxKind::ClassDeclaration
                )
                && decl.children().any(|child| child.kind() == SyntaxKind::TypeParameter)
            {
                return Usefulness::Always;
            }
            if matches_type_or_base_type(|t| self.has_ignored_name(t), ty) {
                return Usefulness::Always;
            }
        }

        if ty.is_intersection() {
            return collect_intersection_type_certainty(ty, |t| self.collect_to_string_certainty(t, walk, depth));
        }
        if ty.is_union() {
            return collect_union_type_certainty(ty, |t| self.collect_to_string_certainty(t, walk, depth));
        }

        if ty.is_tuple_type() || ty.is_array_type() {
            let is_always = walk.is_always.get(&ty).copied();
            if is_always == Some(true) {
                return Usefulness::Always;
            }
            if let Some(assumed) = &mut walk.assumed {
                if is_always == Some(false) {
                    walk.found_other = true;
                    return Usefulness::Always;
                }
                if assumed.insert(ty) {
                    walk.pending.push(ty);
                }
                walk.come_across.push((ty, walk.looked_into));
                return Usefulness::Always;
            }
            if is_always.is_none() && self.is_always_on_every_path(ty, walk, depth) {
                return Usefulness::Always;
            }
            // Less deep, nothing more is cut off.
            if let Some(&known) = walk.known.get(&ty)
                && (depth == known.depth || depth < known.depth && !known.was_cut_off)
            {
                walk.was_cut_off |= known.was_cut_off;
                return known.certainty;
            }
            let revisited_before = walk.first_revisited.take();
            let was_cut_off_before = std::mem::take(&mut walk.was_cut_off);
            let index = walk.visited.len();
            walk.visited.push(ty);
            let certainty = self.collect_elements_certainty(ty, walk, depth);
            walk.visited.pop();
            let revisited_around = walk.first_revisited.filter(|&first| first < index);
            if revisited_around.is_none() {
                let was_cut_off = walk.was_cut_off;
                walk.known.insert(ty, Known { certainty, depth, was_cut_off });
            }
            walk.was_cut_off |= was_cut_off_before;
            walk.first_revisited = match (revisited_before, revisited_around) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            };
            return certainty;
        }

        match is_to_string_like_from_object(ty) {
            None if self.check_unknown && flags == TypeFlags::UNKNOWN => Usefulness::Sometimes,
            None | Some(false) => Usefulness::Always,
            Some(true) => Usefulness::Never,
        }
    }

    fn report<'a>(node: Expr<'a>, message: Message, certainty: Usefulness, cx: &Cx<'a, Self>) {
        let certainty = match certainty {
            Usefulness::Always => return,
            Usefulness::Never => "will",
            Usefulness::Sometimes => "may",
        };
        cx.report(node, message).data("name", node.text()).data("certainty", certainty);
    }

    fn check_expression<'a>(&self, node: Expr<'a>, ty: Option<Type<'a>>, cx: &mut Cx<'a, Self>) {
        if is_literal(node) {
            return;
        }
        let ty = ty.unwrap_or_else(|| node.ty());
        if ty.has_flags(TypeFlags::PRIMITIVE | TypeFlags::ANY | TypeFlags::NEVER) {
            return;
        }
        let collect = || self.collect_to_string_certainty(ty, &mut Walk::default(), 0);
        let certainty = *cx.state.entry((ty, false)).or_insert_with(collect);
        Self::report(node, BASE_TO_STRING, certainty, cx);
    }

    fn check_addition<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (left, right) = match node.kind() {
            ExprKind::Binary { op: BinOp::Add, left, right } => (left, right),
            ExprKind::Assign { op: Some(BinOp::Add), target, value } => (target, value),
            _ => return,
        };
        let (left_type, right_type) = (left.ty(), right.ty());
        if has_type_name_string(left_type) {
            self.check_expression(right, Some(right_type), cx);
        } else if left.tag() != ExprTag::PrivateIdentifier && has_type_name_string(right_type) {
            self.check_expression(left, Some(left_type), cx);
        }
    }

    fn check_call<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = node.kind() else {
            return;
        };
        let callee = call.callee();
        let (object, property) = match callee.kind() {
            ExprKind::Ident(name) => {
                // `isBuiltInStringCall`
                if name.is("String")
                    && let Some(argument) = call.args().first()
                    && argument.tag() != ExprTag::Spread
                    && !is_literal(argument)
                    && callee.symbol().is_none()
                    && Node::Expr(node).scope().resolve_name(name).is_none()
                {
                    self.check_expression(argument, None, cx);
                }
                return;
            }
            ExprKind::Dot { obj, name, .. } => (obj, name.name()),
            ExprKind::Index { obj, index, .. } => match index.as_ident() {
                Some(name) => (obj, name),
                None => return,
            },
            _ => return,
        };
        let is_join = match property.bytes() {
            b"join" => true,
            b"toLocaleString" | b"toString" => false,
            _ => return,
        };
        // `(a?.join)()` calls a `ChainExpression`.
        if callee.is_chain_root() {
            return;
        }
        if is_join {
            let ty = get_constrained_type_at_location(object);
            let collect = || self.collect_join_certainty(ty, &mut Walk::default(), 0);
            let certainty = *cx.state.entry((ty, true)).or_insert_with(collect);
            Self::report(object, BASE_ARRAY_JOIN, certainty, cx);
        } else {
            self.check_expression(object, None, cx);
        }
    }

    fn check_template_literal<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Template(template) = node.kind() else {
            return;
        };
        let expressions = template.exprs();
        if expressions.is_empty() || matches!(node.parent(), Node::Expr(parent) if parent.tag() == ExprTag::TaggedTemplate) {
            return;
        }
        for expression in expressions {
            self.check_expression(expression, None, cx);
        }
    }
}

impl Rule for NoBaseToString {
    const META: Meta = Meta::typescript("no-base-to-string", Kind::Suggestion)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = Certainties<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let names = |names: &[&str]| names.iter().map(|name| name.as_bytes().to_vec()).collect();
        let ignored_type_names: Vec<Vec<u8>> = match options.has("ignoredTypeNames") {
            true => names(&options.strings("ignoredTypeNames")),
            false => names(&["Error", "RegExp", "URL", "URLSearchParams"]),
        };
        NoBaseToString {
            ignores_name_with_bracket: ignored_type_names.iter().any(|name| strings::contains_char(name, b'[')),
            ignored_type_names,
            check_unknown: options.bool_or("checkUnknown", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Certainties<'a> {
        on.exprs([ExprTag::Binary, ExprTag::Assign], Self::check_addition);
        on.exprs([ExprTag::Call], Self::check_call);
        on.exprs([ExprTag::Template], Self::check_template_literal);
        Certainties::default()
    }
}
