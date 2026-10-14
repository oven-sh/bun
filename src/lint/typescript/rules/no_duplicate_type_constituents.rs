use bun_lint::prelude::*;
use bun_lint::types::tsutils::is_intrinsic_error_type;
use bun_lint::types::{IdMap, Type, TypeFlags};
use smallvec::SmallVec;

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

/// [`is_same_ast_node`] of a constituent and a later one. What the later one is a part of is not the same, and all that
/// is around a type that is nested deeply would be compared with it to the end.
fn is_repeated_by<'a>(earlier: TypeNode<'a>, later: TypeNode<'a>) -> bool {
    !earlier.span().contains(later.span()) && is_same_ast_node(earlier, later)
}

/// Whether tsgolint's scanner sees no `|` or `&` in `before_constituent`: from the start of the union or intersection to
/// a constituent. The `}` that ends a substitution of a template type is a brace for it, so the `` ` `` that ends the
/// template starts a string, to the next `` ` ``.
fn is_separator_before_unseen<'a>(file: &'a File<'a>, before_constituent: Span) -> bool {
    let mut is_in_string = false;
    for token in file.tokens_in(before_constituent) {
        match token.kind() {
            TokenKind::Template => {
                let text = token.text();
                is_in_string = text.ends_with(b"`") && text.starts_with(b"`") == is_in_string;
            }
            TokenKind::Punctuator if !is_in_string && (token.is("|") || token.is("&")) => return false,
            _ => {}
        }
    }
    true
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

    // The `|` or `&` and the parentheses around the constituent, which go with it. tsgolint's constituent is the
    // parenthesized type: it goes whole, with the comments and line breaks between its parentheses.
    let is_oxlint = cx.language().is_oxlint;
    let mut removed: SmallVec<[Span; 8]> = SmallVec::new();
    removed.push(match is_oxlint {
        true => constituent_node.outer_span(),
        false => constituent_node.span(),
    });
    // tsgolint removes the `|` or `&` after the constituent where its scanner sees none before it.
    let outer = constituent_node.outer_span();
    let is_before_unseen = is_oxlint
        && is_separator_before_unseen(file, Span::new(parent.start, outer.start))
        && file.token_after(outer).is_some_and(|token| is_union_or_intersection_token(&token));
    let before_union_or_intersection_token = match is_before_unseen {
        true => None,
        false => file
            .tokens_before(constituent_node)
            .take_while(|token| token.start() >= parent.start)
            .find(is_union_or_intersection_token),
    };
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
    if !is_oxlint {
        removed.extend(bracket_before_tokens.map(|token| token.span()));
        for token in bracket_after_tokens {
            end = token.end();
            removed.push(token.span());
        }
    }

    // oxlint points at the first of the two. tsgolint's constituent is the parenthesized type.
    let place = match (is_oxlint, previous) {
        (true, Some((_, previous))) => previous.outer_span(),
        (true, None) => constituent_node.outer_span(),
        (false, _) => Span::new(constituent_node.span().start, end),
    };
    let mut report = cx.report(place, message).comments_apply_at(constituent_node.outer_span());
    if let Some((union_or_intersection, previous)) = previous {
        // tsgolint 7.0 says it with its parentheses and with what is before it, from the end of the token before.
        let (file, outer) = (previous.file(), previous.outer_span());
        let text = match file.language().is_oxlint {
            true => file.slice(Span::new(file.end_of_token_before(outer.start), outer.end)),
            false => previous.text(),
        };
        report = report.data("type", union_or_intersection).data("previous", text).labels_with(|labels| {
            labels.first(format!("Type '{}' is first declared here.", bstr::BStr::new(file.slice(outer))));
            labels.push(constituent_node.outer_span(), "");
        });
    }
    report.fix(|fixer| removed.iter().map(|&span| fixer.remove(span)).collect::<Vec<Fix>>());
}

struct Constituents<'a> {
    /// `Union` or `Intersection`
    tag: TypeTag,
    /// The union is the type of an optional parameter.
    is_of_optional_parameter: bool,
    unique_constituents: Vec<TypeNode<'a>>,
    cached_type_map: IdMap<Type<'a>, TypeNode<'a>>,
}

impl<'a> Constituents<'a> {
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

        // The syntax is compared first, which is cheaper than to ask for the type. tsgolint 7.0 only compares the
        // types: `{ a: 1 } | { a: 1 }` are two.
        if !cx.language().is_oxlint
            && let Some(&previous) = self.unique_constituents.iter().find(|it| is_repeated_by(**it, constituent_node))
        {
            report_duplicate(previous);
            return;
        }
        let ty = constituent_node.ty();
        if is_intrinsic_error_type(ty) || ty.is_unresolved() {
            return;
        }
        let mut is_new = false;
        let previous = *self.cached_type_map.get_or_insert_with(ty, || {
            is_new = true;
            constituent_node
        });
        if !is_new {
            report_duplicate(previous);
            return;
        }

        if self.is_of_optional_parameter && ty.has_flags(TypeFlags::UNDEFINED) {
            report(cx, UNNECESSARY, constituent_node, None);
        }
        self.unique_constituents.push(constituent_node);

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
        // tsgolint asks only for the question token, and only a constructor has parameter properties.
        let is_of_optional_parameter = tag == TypeTag::Union
            && matches!(parent, Node::Param(param) if param.is_optional()
                && match cx.language().is_oxlint {
                    true => {
                        !(param.is_parameter_property()
                            && param.func().is_some_and(|func| func.kind() == FnKind::Constructor))
                    }
                    false => {
                        param.pat().tag() == PatTag::Ident
                            && !param.is_rest()
                            && !param.is_parameter_property()
                            && param.default().is_none()
                            && param.func().is_some_and(|func| func.kind() != FnKind::IndexSignature)
                    }
                });
        let mut constituents = Constituents {
            tag,
            is_of_optional_parameter,
            unique_constituents: Vec::new(),
            cached_type_map: IdMap::new(),
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
    const ON: On = On::new().types(&[TypeTag::Intersection, TypeTag::Union]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoDuplicateTypeConstituents {
            ignore_intersections: options.bool_or("ignoreIntersections", false),
            ignore_unions: options.bool_or("ignoreUnions", false),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new();
        if !self.ignore_intersections {
            on = on.types(&[TypeTag::Intersection]);
        }
        if !self.ignore_unions {
            on = on.types(&[TypeTag::Union]);
        }
        on
    }

    fn ty<'a>(&self, node: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        self.check_duplicate(node, cx);
    }
}
