use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::utils::{
    get_constrained_type_at_location, get_type_name, is_builtin_symbol_like, is_symbol_from_default_library,
    matches_type_or_base_type,
};
use bun_lint::types::{IdMap, IdSet, SyntaxKind, TsNode, Type, TypeFlags, tsutils};
use smallvec::SmallVec;

/// Require `.toString()` and `.toLocaleString()` to only be called on objects which provide useful information when stringified.
pub struct NoBaseToString {
    ignored_type_names: Vec<Vec<u8>>,
    /// True if one of them contains a `[`.
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

const KINDS: [ExprTag; 4] = [ExprTag::Binary, ExprTag::Assign, ExprTag::Call, ExprTag::Template];

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Usefulness {
    Always,
    Never,
    Sometimes,
}

/// State for computing one expression's certainty.
#[derive(Default)]
struct Walk<'a> {
    /// The array and tuple types currently being examined.
    visited: SmallVec<[Type<'a>; 4]>,
    /// Cached results of [`NoBaseToString::is_always_on_every_path`] for array and tuple types.
    is_always: IdMap<Type<'a>, bool>,
    /// Set while `is_always_on_every_path` runs: the array and tuple types it has reached.
    assumed: Option<IdSet<Type<'a>>>,
    /// Those of them that still have to be examined.
    pending: Vec<Type<'a>>,
    /// The one being examined.
    examining: Option<Type<'a>>,
    /// Each type it reached, paired with the type it was reached from.
    reached_from: Vec<(Type<'a>, Option<Type<'a>>)>,
    /// True if something wasn't [`Usefulness::Always`] since `examining` was started.
    found_non_always: bool,
    /// The result for an array or tuple type, if it doesn't depend on what was in `visited`. Without this cache, a
    /// `[T, T]` of a `[U, U]` of .. is examined two to the power of the depth times.
    known: IdMap<Type<'a>, Usefulness>,
    /// The lowest index in `visited` that was reached again since the current type was started.
    first_revisited: Option<usize>,
    /// True if the stack ran out of room since then. Upstream overflows its stack.
    was_cut_off: bool,
}

/// Cached results per expression type, separately for `join()`. tsgolint caches every type for the whole file, so for
/// it these are its `toStringMemo` and `joinMemo`.
#[derive(Default)]
pub struct Certainties<'a> {
    /// Index 1 is for `join()`.
    known: [IdMap<Type<'a>, Usefulness>; 2],
    /// tsgolint's `resolving`: the types whose `toStringMemo` entry is being computed.
    resolving: IdSet<Type<'a>>,
}

/// tsgolint's `isBuiltInStringCall` checks the callee's type, not what its scope declares.
fn has_type_of_string_constructor(callee: Expr) -> bool {
    let ty = callee.ty();
    is_builtin_symbol_like(ty, "String") || is_builtin_symbol_like(ty, "StringConstructor")
}

/// `getTypeName(checker, type) === 'string'`
fn has_type_name_string(ty: Type) -> bool {
    let flags = ty.flags();
    flags.intersects(TypeFlags::STRING_LIKE)
        || flags.intersects(TypeFlags::TYPE_PARAMETER | TypeFlags::UNION_OR_INTERSECTION) && get_type_name(ty) == b"string"
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

/// tsgolint's `collectUnionTypeCertainty` visits every constituent, because each one's result is cached.
fn tsgolint_collect_union_type_certainty<'a>(
    ty: Type<'a>,
    mut collect_sub_type_certainty: impl FnMut(Type<'a>) -> Usefulness,
) -> Usefulness {
    let (mut all_never, mut all_always) = (true, true);
    for t in ty.types() {
        let certainty = collect_sub_type_certainty(t);
        all_never &= certainty == Usefulness::Never;
        all_always &= certainty == Usefulness::Always;
    }
    match (all_never, all_always) {
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

/// True if it's a member of `interface Object`.
fn is_declared_on_object(declaration: TsNode) -> bool {
    declaration.parent().is_some_and(|parent| {
        parent.kind() == SyntaxKind::InterfaceDeclaration && parent.name().is_some_and(|name| name.text() == b"Object")
    })
}

/// `None` if the type has none of the methods.
fn is_to_string_like_from_object(ty: Type) -> Option<bool> {
    // An explicit `[Symbol.toPrimitive]` declaration is always user-defined.
    if tsutils::get_well_known_symbol_property_of_type(ty, "toPrimitive")
        .and_then(|property| property.value_declaration())
        .is_some_and(is_symbol_to_primitive_method)
    {
        return Some(false);
    }
    is_fallback_on_object(ty)
}

/// True if the methods that type coercion uses are all declared on `Object` itself. `None` if the type has none of
/// them.
fn is_fallback_on_object(ty: Type) -> Option<bool> {
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
        // The text of an array or tuple type without its own name contains a `[`. It also contains the text of every
        // type inside it, which would be printed again for each of them.
        let has_bracket = || ty.alias_symbol().is_none() && (ty.is_tuple_type() || ty.is_array_type());
        (self.ignores_name_with_bracket || !has_bracket()) && self.is_ignored(&get_type_name(ty))
    }

    fn collect_tuple_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>) -> Usefulness {
        let mut certainty = Usefulness::Always;
        for t in ty.get_type_arguments() {
            match self.collect_to_string_certainty(t, walk) {
                Usefulness::Never => return Usefulness::Never,
                Usefulness::Sometimes => certainty = Usefulness::Sometimes,
                Usefulness::Always => {}
            }
        }
        certainty
    }

    fn collect_array_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>) -> Usefulness {
        match ty.get_number_index_type() {
            Some(elem_type) => self.collect_to_string_certainty(elem_type, walk),
            None => Usefulness::Always,
        }
    }

    fn collect_elements_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>) -> Usefulness {
        match ty.is_tuple_type() {
            true => self.collect_tuple_certainty(ty, walk),
            false => self.collect_array_certainty(ty, walk),
        }
    }

    fn collect_join_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>) -> Usefulness {
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return Usefulness::Always;
        }
        if ty.is_union() {
            return collect_union_type_certainty(ty, |t| self.collect_join_certainty(t, walk));
        }
        if ty.is_intersection() {
            return collect_intersection_type_certainty(ty, |t| self.collect_join_certainty(t, walk));
        }
        if ty.is_tuple_type() {
            return self.collect_tuple_certainty(ty, walk);
        }
        if ty.is_array_type() {
            return self.collect_array_certainty(ty, walk);
        }
        Usefulness::Always
    }

    /// True if the array or tuple type `ty` is `Always` regardless of what's in `visited`.
    ///
    /// Upstream examines the types in a cycle once for every path that reaches them, which never finishes when a dozen
    /// of them refer to each other. This examines every type once and assumes the ones inside it are `Always`. If
    /// nothing else turns up, every path gives the same result.
    ///
    /// The result is cached for every type it reached, so that the rest of a chain isn't re-examined from each of its
    /// links.
    fn is_always_on_every_path<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>) -> bool {
        walk.assumed.insert(IdSet::new()).insert(ty);
        walk.pending.push(ty);
        let mut assumed = Vec::new();
        let mut others = Vec::new();
        while let Some(t) = walk.pending.pop() {
            assumed.push(t);
            walk.examining = Some(t);
            walk.found_non_always = false;
            self.collect_elements_certainty(t, walk);
            if walk.found_non_always {
                others.push(t);
            }
        }
        walk.assumed = None;
        let reached_from = std::mem::take(&mut walk.reached_from);
        if others.is_empty() {
            walk.is_always.extend(assumed.into_iter().map(|t| (t, true)));
            return true;
        }
        // Find every type that contains one of `others`, at any depth.
        let mut containers: IdMap<Type<'a>, SmallVec<[Type<'a>; 1]>> = IdMap::new();
        for (inner, outer) in reached_from {
            containers.get_or_insert_with(inner, SmallVec::new).extend(outer);
        }
        let mut has_other: IdSet<Type<'a>> = others.iter().copied().collect();
        while let Some(t) = others.pop() {
            for &outer in containers.get(t).map(|it| it.as_slice()).unwrap_or_default() {
                if has_other.insert(outer) {
                    others.push(outer);
                }
            }
        }
        walk.is_always.extend(assumed.into_iter().map(|t| (t, !has_other.contains(t))));
        false
    }

    fn collect_to_string_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>) -> Usefulness {
        let certainty = self.to_string_certainty(ty, walk);
        walk.found_non_always |= certainty != Usefulness::Always;
        certainty
    }

    fn to_string_certainty<'a>(&self, ty: Type<'a>, walk: &mut Walk<'a>) -> Usefulness {
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            walk.found_non_always = true;
            walk.was_cut_off = true;
            return Usefulness::Always;
        }
        // A self-referencing array or tuple type isn't reported.
        if walk.assumed.is_none()
            && let Some(revisited) = walk.visited.iter().position(|it| *it == ty)
        {
            walk.first_revisited = Some(walk.first_revisited.map_or(revisited, |first| first.min(revisited)));
            return Usefulness::Always;
        }
        let flags = ty.flags();

        // Everything below would return `Always` for these.
        if flags.intersects(TypeFlags::PRIMITIVE | TypeFlags::ANY | TypeFlags::NEVER) {
            return Usefulness::Always;
        }

        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return match ty.get_constraint() {
                Some(constraint) => self.collect_to_string_certainty(constraint, walk),
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
            return collect_intersection_type_certainty(ty, |t| self.collect_to_string_certainty(t, walk));
        }
        if ty.is_union() {
            return collect_union_type_certainty(ty, |t| self.collect_to_string_certainty(t, walk));
        }

        if ty.is_tuple_type() || ty.is_array_type() {
            let is_always = walk.is_always.get(ty).copied();
            if is_always == Some(true) {
                return Usefulness::Always;
            }
            if let Some(assumed) = &mut walk.assumed {
                if is_always == Some(false) {
                    walk.found_non_always = true;
                    return Usefulness::Always;
                }
                if assumed.insert(ty) {
                    walk.pending.push(ty);
                }
                walk.reached_from.push((ty, walk.examining));
                return Usefulness::Always;
            }
            if is_always.is_none() && self.is_always_on_every_path(ty, walk) {
                return Usefulness::Always;
            }
            if let Some(&known) = walk.known.get(ty) {
                return known;
            }
            let revisited_before = walk.first_revisited.take();
            let was_cut_off_before = std::mem::take(&mut walk.was_cut_off);
            let index = walk.visited.len();
            walk.visited.push(ty);
            let certainty = self.collect_elements_certainty(ty, walk);
            walk.visited.pop();
            let revisited_outer = walk.first_revisited.filter(|&first| first < index);
            if revisited_outer.is_none() && !walk.was_cut_off {
                walk.known.insert(ty, certainty);
            }
            walk.was_cut_off |= was_cut_off_before;
            walk.first_revisited = match (revisited_before, revisited_outer) {
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

    /// tsgolint's `collectToStringCertainty`.
    fn tsgolint_collect_to_string_certainty<'a>(
        &self,
        ty: Type<'a>,
        visited: &mut IdSet<Type<'a>>,
        memo: &mut Certainties<'a>,
    ) -> Usefulness {
        // A self-referencing array or tuple type isn't reported.
        if visited.contains(ty) {
            return Usefulness::Always;
        }
        if let Some(&certainty) = memo.known[0].get(ty) {
            return certainty;
        }
        if !bun_core::StackCheck::init().is_safe_to_recurse() || !memo.resolving.insert(ty) {
            return Usefulness::Always;
        }
        let certainty = self.tsgolint_to_string_certainty(ty, visited, memo);
        memo.resolving.remove(ty);
        memo.known[0].insert(ty, certainty);
        certainty
    }

    fn tsgolint_to_string_certainty<'a>(
        &self,
        ty: Type<'a>,
        visited: &mut IdSet<Type<'a>>,
        memo: &mut Certainties<'a>,
    ) -> Usefulness {
        let flags = ty.flags();
        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return match ty.get_constraint() {
                Some(constraint) => self.tsgolint_collect_to_string_certainty(constraint, visited, memo),
                // An unconstrained generic means `unknown`.
                None if self.check_unknown => Usefulness::Sometimes,
                None => Usefulness::Always,
            };
        }
        // These have no properties, and the `Boolean` type definition is missing `toString()`. Any other primitive
        // type's properties are checked: without `interface BigInt` in the lib, a `bigint` has `Object`'s.
        let always = TypeFlags::ANY | TypeFlags::NEVER | TypeFlags::NULL | TypeFlags::VOID_LIKE | TypeFlags::BOOLEAN_LIKE;
        if flags.intersects(always) {
            return Usefulness::Always;
        }
        // The name is the type's text, so `Foo<string>` isn't `Foo`.
        if !self.ignored_type_names.is_empty() && matches_type_or_base_type(|t| self.has_ignored_name(t), ty) {
            return Usefulness::Always;
        }
        if ty.is_intersection() {
            return collect_intersection_type_certainty(ty, |t| {
                self.tsgolint_collect_to_string_certainty(t, visited, memo)
            });
        }
        if ty.is_union() {
            return tsgolint_collect_union_type_certainty(ty, |t| {
                self.tsgolint_collect_to_string_certainty(t, visited, memo)
            });
        }
        if ty.is_tuple_type() || ty.is_array_type() {
            visited.insert(ty);
            let certainty = self.tsgolint_collect_elements_certainty(ty, visited, memo);
            visited.remove(ty);
            return certainty;
        }
        match is_fallback_on_object(ty) {
            Some(true) => Usefulness::Never,
            Some(false) => Usefulness::Always,
            None if self.check_unknown && flags.intersects(TypeFlags::UNKNOWN) => Usefulness::Sometimes,
            None => Usefulness::Always,
        }
    }

    /// tsgolint's `collectTupleCertainty`, which visits every element, and `collectArrayCertainty`.
    fn tsgolint_collect_elements_certainty<'a>(
        &self,
        ty: Type<'a>,
        visited: &mut IdSet<Type<'a>>,
        memo: &mut Certainties<'a>,
    ) -> Usefulness {
        if !ty.is_tuple_type() {
            return match ty.get_number_index_type() {
                Some(elem_type) => self.tsgolint_collect_to_string_certainty(elem_type, visited, memo),
                None => Usefulness::Always,
            };
        }
        let (mut has_never, mut has_sometimes) = (false, false);
        for t in ty.get_type_arguments() {
            let certainty = self.tsgolint_collect_to_string_certainty(t, visited, memo);
            has_never |= certainty == Usefulness::Never;
            has_sometimes |= certainty == Usefulness::Sometimes;
        }
        match (has_never, has_sometimes) {
            (true, _) => Usefulness::Never,
            (false, true) => Usefulness::Sometimes,
            (false, false) => Usefulness::Always,
        }
    }

    /// tsgolint's `collectJoinCertainty`.
    fn tsgolint_collect_join_certainty<'a>(&self, ty: Type<'a>, memo: &mut Certainties<'a>) -> Usefulness {
        if let Some(&certainty) = memo.known[1].get(ty) {
            return certainty;
        }
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return Usefulness::Always;
        }
        let certainty = if ty.is_union() {
            tsgolint_collect_union_type_certainty(ty, |t| self.tsgolint_collect_join_certainty(t, memo))
        } else if ty.is_intersection() {
            collect_intersection_type_certainty(ty, |t| self.tsgolint_collect_join_certainty(t, memo))
        } else if ty.is_tuple_type() || ty.is_array_type() {
            self.tsgolint_collect_elements_certainty(ty, &mut IdSet::new(), memo)
        } else {
            Usefulness::Always
        };
        memo.known[1].insert(ty, certainty);
        certainty
    }

    fn report<'a>(node: Expr<'a>, message: Message, certainty: Usefulness, cx: &Cx<'a, Self>) {
        let certainty = match certainty {
            Usefulness::Always => return,
            Usefulness::Never => "will",
            Usefulness::Sometimes => "may",
        };
        // oxlint's span and name include the parentheses around it.
        let (report_span, name) = match cx.language().is_oxlint {
            true => (node.outer_span(), cx.file().slice(node.outer_span())),
            false => (node.span(), node.text()),
        };
        cx.report(report_span, message).data("name", name).data("certainty", certainty);
    }

    fn check_expression<'a>(&self, node: Expr<'a>, ty: Option<Type<'a>>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        // tsgolint's `IsLiteralExpression` is false for a literal in parentheses.
        if ast_utils::is_literal(node) && !(is_oxlint && node.is_parenthesized()) {
            return;
        }
        let ty = ty.unwrap_or_else(|| node.ty());
        if is_oxlint {
            let certainty = self.tsgolint_collect_to_string_certainty(ty, &mut IdSet::new(), &mut cx.state);
            Self::report(node, BASE_TO_STRING, certainty, cx);
            return;
        }
        if ty.has_flags(TypeFlags::PRIMITIVE | TypeFlags::ANY | TypeFlags::NEVER) {
            return;
        }
        let certainty =
            *cx.state.known[0].get_or_insert_with(ty, || self.collect_to_string_certainty(ty, &mut Walk::default()));
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
        let is_oxlint = cx.language().is_oxlint;
        // For tsgolint a parenthesized callee is a `ParenthesizedExpression`, which it doesn't look into.
        if is_oxlint && callee.is_parenthesized() {
            return;
        }
        let (object, property) = match callee.kind() {
            ExprKind::Ident(name) => {
                // `isBuiltInStringCall`
                if name.is("String")
                    && let Some(argument) = call.args().first()
                    && argument.tag() != ExprTag::Spread
                {
                    let is_built_in = match is_oxlint {
                        true => has_type_of_string_constructor(callee),
                        false => {
                            !ast_utils::is_literal(argument)
                                && callee.symbol().is_none()
                                && Node::Expr(node).scope().resolve_name(name).is_none()
                        }
                    };
                    if is_built_in {
                        self.check_expression(argument, None, cx);
                    }
                }
                return;
            }
            ExprKind::Dot { obj, name, .. } => (obj, name.name()),
            ExprKind::Index { obj, index, .. } => match index.as_ident() {
                // tsgolint only looks at a `PropertyAccessExpression`.
                Some(name) if !is_oxlint => (obj, name),
                _ => return,
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
            let certainty = match is_oxlint {
                true => self.tsgolint_collect_join_certainty(ty, &mut cx.state),
                false => {
                    *cx.state.known[1].get_or_insert_with(ty, || self.collect_join_certainty(ty, &mut Walk::default()))
                }
            };
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
        // tsgolint checks the parent, which is the `ParenthesizedExpression` if the template is a parenthesized tag.
        if expressions.is_empty()
            || matches!(node.parent(), Node::Expr(parent) if parent.tag() == ExprTag::TaggedTemplate)
                && !(cx.language().is_oxlint && node.is_parenthesized())
        {
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
    const ON: On = On::new().exprs(&KINDS).enter(NodeTags::new().exprs(&KINDS));
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

    // tsgolint caches each type's result while it walks the file, so its results depend on the visiting order.
    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        match file.language().is_oxlint {
            true => On::new().enter(NodeTags::new().exprs(&KINDS)),
            false => On::new().exprs(&KINDS),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Certainties<'a>> {
        Some(Certainties::default())
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            ExprTag::Binary | ExprTag::Assign => self.check_addition(node, cx),
            ExprTag::Call => self.check_call(node, cx),
            ExprTag::Template => self.check_template_literal(node, cx),
            _ => {}
        }
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Expr(node) = node {
            self.expr(node, cx);
        }
    }
}
