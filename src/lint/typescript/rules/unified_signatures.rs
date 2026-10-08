use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Disallow two overloads that could be unified into one with a union or an optional/rest parameter.
pub struct UnifiedSignatures {
    ignore_differently_named_parameters: bool,
    ignore_overloads_with_different_jsdoc: bool,
}

const ALL_PARAMETERS_ARE_SAME: Message = Message::new(
    "allParametersAreSame",
    "{{failureStringStart}} with identical parameters.",
);
const OMITTING_REST_PARAMETER: Message = Message::new(
    "omittingRestParameter",
    "{{failureStringStart}} with a rest parameter.",
);
const OMITTING_SINGLE_PARAMETER: Message = Message::new(
    "omittingSingleParameter",
    "{{failureStringStart}} with an optional parameter.",
);
const SINGLE_PARAMETER_DIFFERENCE: Message = Message::new(
    "singleParameterDifference",
    "{{failureStringStart}} taking `{{types}}`.",
);

enum Unify<'a> {
    ExtraParameter {
        extra_parameter: Param<'a>,
        other_signature: Func<'a>,
    },
    AllParametersAreSame {
        signature0: Func<'a>,
        signature1: Func<'a>,
    },
    SingleParameterDifference {
        p0: Param<'a>,
        p1: Param<'a>,
    },
}

/// What upstream's `getOverloadKey` is made of. Signatures with the same key are overloads.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
struct OverloadKey<'a> {
    is_computed: bool,
    is_static: bool,
    info: OverloadInfo<'a>,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum OverloadInfo<'a> {
    /// `new ()` in an interface or a type literal.
    Construct,
    /// `()` in an interface or a type literal.
    Call,
    PrivateIdentifier(Name<'a>),
    Identifier(Name<'a>),
    /// A literal, as it is written.
    Raw(&'a [u8]),
    /// Any other expression in brackets. Upstream has the same key for all of them.
    Expression,
    Function(Name<'a>),
    /// `export default function ()`
    ExportDefaultDeclaration,
}

#[derive(Copy, Clone)]
struct Overload<'a> {
    key: OverloadKey<'a>,
    signature: Func<'a>,
}

/// typescript-eslint's `getOverloadInfo` for the `key` of a method.
fn get_overload_info<'a>(key: Key<'a>, file: &File<'a>) -> OverloadInfo<'a> {
    match key.kind() {
        KeyKind::Private(name) => OverloadInfo::PrivateIdentifier(name),
        KeyKind::Ident(name) => OverloadInfo::Identifier(name),
        KeyKind::String(_) | KeyKind::Number(_) | KeyKind::ComputedNumber(_) | KeyKind::ComputedString(_) => {
            match file.slice(key.inner_span(file)) {
                // A template is not a literal.
                [b'`', ..] => OverloadInfo::Expression,
                raw => OverloadInfo::Raw(raw),
            }
        }
        KeyKind::Computed(e) => match e.kind() {
            ExprKind::Ident(name) => OverloadInfo::Identifier(name),
            ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::Regex(_) => OverloadInfo::Raw(e.text()),
            _ => OverloadInfo::Expression,
        },
    }
}

/// A method without a body, or a signature, that is not an accessor.
fn overload_of_member(member: Member<'_>) -> Option<Overload<'_>> {
    let signature = member.func().filter(|it| !it.has_body())?;
    let file = member.file();
    let (is_computed, info) = match member.kind() {
        MemberKind::ConstructSignature => (false, OverloadInfo::Construct),
        MemberKind::CallSignature => (false, OverloadInfo::Call),
        MemberKind::Constructor => {
            let keyword = member.constructor_keyword()?;
            match keyword.is_string() {
                true => (false, OverloadInfo::Raw(file.slice(keyword.span()))),
                false => (false, OverloadInfo::Identifier(keyword.name())),
            }
        }
        MemberKind::Method => {
            let key = member.key()?;
            (key.is_computed(), get_overload_info(key, file))
        }
        _ => return None,
    };
    let key = OverloadKey {
        is_computed,
        is_static: member.is_static(),
        info,
    };
    Some(Overload { key, signature })
}

/// A function declaration without a body: ESLint's `TSDeclareFunction`.
fn overload_of_statement(statement: Stmt<'_>) -> Option<Overload<'_>> {
    let StmtKind::Fn(signature) = statement.kind() else {
        return None;
    };
    if signature.has_body() {
        return None;
    }
    let info = match signature.name() {
        Some(name) => OverloadInfo::Function(name.name()),
        None => OverloadInfo::ExportDefaultDeclaration,
    };
    let key = OverloadKey {
        is_computed: false,
        is_static: false,
        info,
    };
    Some(Overload { key, signature })
}

/// ESLint's `type` of a parameter.
#[derive(Copy, Clone, PartialEq, Eq)]
enum ParameterType {
    TSParameterProperty,
    RestElement,
    AssignmentPattern,
    Identifier,
    ObjectPattern,
    ArrayPattern,
}

fn parameter_type(parameter: Param<'_>) -> ParameterType {
    if parameter.is_parameter_property() {
        ParameterType::TSParameterProperty
    } else if parameter.is_rest() {
        ParameterType::RestElement
    } else if parameter.default().is_some() {
        ParameterType::AssignmentPattern
    } else {
        match parameter.pat().tag() {
            PatTag::Object => ParameterType::ObjectPattern,
            PatTag::Array => ParameterType::ArrayPattern,
            PatTag::Ident | PatTag::Missing => ParameterType::Identifier,
        }
    }
}

fn is_rest_element(parameter: Param<'_>) -> bool {
    parameter_type(parameter) == ParameterType::RestElement
}

/// The range of ESLint's node for a parameter.
fn parameter_span(parameter: Param<'_>) -> Span {
    match parameter.is_parameter_property() {
        true => parameter.span(),
        false => parameter.span_without_modifiers(),
    }
}

/// typescript-eslint's `getParameterTypeAnnotation`. The annotation of `a: T = 1` belongs to the
/// `a`, not to the `AssignmentPattern` that the parameter is.
fn get_parameter_type_annotation(parameter: Param<'_>) -> Option<TypeNode<'_>> {
    match parameter.default() {
        Some(_) => None,
        None => parameter.ty(),
    }
}

/// `parameter.optional`, which is likewise that of the `AssignmentPattern`.
fn is_optional(parameter: Param<'_>) -> bool {
    parameter.is_optional() && parameter.default().is_none()
}

fn get_static_parameter_name(parameter: Param<'_>) -> Option<Name<'_>> {
    match parameter_type(parameter) {
        ParameterType::Identifier | ParameterType::RestElement => parameter.pat().as_ident(),
        _ => None,
    }
}

fn is_this_param(parameter: Option<&Param<'_>>) -> bool {
    parameter.is_some_and(|it| {
        parameter_type(*it) == ParameterType::Identifier && it.pat().as_ident().is_some_and(|name| name.is("this"))
    })
}

fn is_this_void_param(parameter: Option<&Param<'_>>) -> bool {
    is_this_param(parameter)
        && parameter.and_then(|it| it.ty()).is_some_and(|ty| ty.is_keyword(Keyword::Void))
}

fn types_are_equal<'a>(a: Option<TypeNode<'a>>, b: Option<TypeNode<'a>>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => a.text() == b.text(),
        _ => false,
    }
}

/// False if one is optional and the other isn't, or one is a rest parameter and the other isn't.
fn parameters_have_equal_sigils<'a>(a: Param<'a>, b: Param<'a>) -> bool {
    is_rest_element(a) == is_rest_element(b) && is_optional(a) == is_optional(b)
}

fn parameters_are_equal<'a>(a: Param<'a>, b: Param<'a>) -> bool {
    parameters_have_equal_sigils(a, b)
        && types_are_equal(get_parameter_type_annotation(a), get_parameter_type_annotation(b))
}

/// True for optional/rest parameters.
fn parameter_may_be_missing(parameter: Param<'_>) -> bool {
    is_rest_element(parameter) || is_optional(parameter)
}

fn type_parameters_are_equal<'a>(a: TypeParam<'a>, b: TypeParam<'a>) -> bool {
    a.name().name() == b.name().name() && types_are_equal(a.constraint(), b.constraint())
}

/// Whether `ty` is one of `outer`, or an array of it, or `keyof` or `readonly` of it, and so on.
fn type_contains_type_parameter<'a>(mut ty: TypeNode<'a>, outer: List<'a, TypeParam<'a>>) -> bool {
    loop {
        ty = match ty.kind() {
            TypeKind::Ref { name, .. } => {
                return name
                    .as_ident()
                    .is_some_and(|name| outer.iter().any(|it| it.name().name() == name.name()));
            }
            TypeKind::Array(inner) | TypeKind::Keyof(inner) | TypeKind::Readonly(inner) => inner,
            TypeKind::Mapped(mapped) => match mapped.ty() {
                Some(inner) => inner,
                None => return false,
            },
            _ => return false,
        };
    }
}

/// True if any of the outer type parameters are used in a signature.
fn signature_uses_type_parameter<'a>(parameters: &[Param<'a>], outer: Option<List<'a, TypeParam<'a>>>) -> bool {
    outer.is_some_and(|outer| {
        parameters
            .iter()
            .filter_map(|it| get_parameter_type_annotation(*it))
            .any(|ty| type_contains_type_parameter(ty, outer))
    })
}

/// The last block comment before the declaration of `signature`.
fn get_block_comment_for_node(signature: Func<'_>) -> Option<&[u8]> {
    let mut comments = signature.file().comments_before(signature.owner());
    comments.rfind(|comment| comment.kind() == TokenKind::Block).map(Token::comment_value)
}

/// Detect no difference, i.e. `a(x: number, y: string)` and `a(x: number, y: string)`,
/// or one param difference, i.e. `a(x: number, y: number, z: number)` and `a(x: number, y: string, z: number)`.
fn signatures_have_same_amount_of_parameters<'a>(
    signature0: Func<'a>,
    signature1: Func<'a>,
    types1: &[Param<'a>],
    types2: &[Param<'a>],
) -> Option<Unify<'a>> {
    // exempt signatures with `this: void` from the rule
    if is_this_void_param(types1.first()) || is_this_void_param(types2.first()) {
        return None;
    }
    let mut pairs = types1.iter().zip(types2);
    let Some((&a, &b)) = pairs.find(|(a, b)| !parameters_are_equal(**a, **b)) else {
        return Some(Unify::AllParametersAreSame {
            signature0,
            signature1,
        });
    };
    // If the remaining ones are equal, the signatures differ by just one parameter type
    if !pairs.all(|(a, b)| parameters_are_equal(*a, *b)) {
        return None;
    }
    // Can unify `a?: string` and `b?: number`. Can't unify `...args: string[]` and `...args: number[]`.
    (parameters_have_equal_sigils(a, b) && !is_rest_element(a))
        .then_some(Unify::SingleParameterDifference { p0: a, p1: b })
}

/// Detect `a(): void` and `a(x: number): void`.
fn signatures_differ_by_optional_or_rest_parameter<'a>(
    a: Func<'a>,
    b: Func<'a>,
    sig1: &[Param<'a>],
    sig2: &[Param<'a>],
) -> Option<Unify<'a>> {
    let min_length = sig1.len().min(sig2.len());
    let (longer, shorter, shorter_sig) = match sig1.len() < sig2.len() {
        true => (sig2, sig1, a),
        false => (sig1, sig2, b),
    };
    // If one signature has explicit this type and another doesn't, they can't be unified.
    if is_this_param(sig1.first()) != is_this_param(sig2.first()) {
        return None;
    }
    // exempt signatures with `this: void` from the rule
    if is_this_void_param(sig1.first()) || is_this_void_param(sig2.first()) {
        return None;
    }
    // If one is has 2+ parameters more than the other, they must all be optional/rest.
    // Differ by optional parameters: f() and f(x), f() and f(x, ?y, ...z)
    // Not allowed: f() and f(x, y)
    if !longer.iter().skip(min_length + 1).all(|it| parameter_may_be_missing(*it)) {
        return None;
    }
    let have_equal_types = |(a, b): (&Param<'a>, &Param<'a>)| {
        types_are_equal(get_parameter_type_annotation(*a), get_parameter_type_annotation(*b))
    };
    if !sig1.iter().zip(sig2).all(have_equal_types) {
        return None;
    }
    if shorter.last().is_some_and(|it| is_rest_element(*it)) {
        return None;
    }
    Some(Unify::ExtraParameter {
        extra_parameter: *longer.last()?,
        other_signature: shorter_sig,
    })
}

type UnionMembers<'a> = SmallVec<[TypeNode<'a>; 8]>;

/// Adds the members of `ty` that are not written in `members` already.
fn add_union_members<'a>(ty: TypeNode<'a>, members: &mut UnionMembers<'a>) {
    match ty.kind() {
        TypeKind::Union(types) => types.iter().for_each(|it| add_union_members(it, members)),
        _ if members.iter().any(|other| other.text() == ty.text()) => {}
        _ => members.push(ty),
    }
}

fn add_union_member_text(ty: TypeNode<'_>, text: &mut Vec<u8>) {
    let needs_parentheses = matches!(ty.tag(), TypeTag::Cond | TypeTag::Fn);
    if needs_parentheses {
        text.push(b'(');
    }
    text.extend_from_slice(ty.text());
    if needs_parentheses {
        text.push(b')');
    }
}

fn get_unified_type_text<'a>(type0: Option<TypeNode<'a>>, type1: Option<TypeNode<'a>>) -> Vec<u8> {
    let mut text = Vec::new();
    let (Some(type0), Some(type1)) = (type0, type1) else {
        // One of the parameters has no type annotation.
        if let Some(only) = type0.or(type1) {
            add_union_member_text(only, &mut text);
        }
        return text;
    };
    let mut members = UnionMembers::new();
    add_union_members(type0, &mut members);
    add_union_members(type1, &mut members);
    for (i, member) in members.into_iter().enumerate() {
        if i > 0 {
            text.extend_from_slice(b" | ");
        }
        add_union_member_text(member, &mut text);
    }
    text
}

/// `other`: where the other overload is. With only 2 overloads there is no need to say which it is.
fn failure_string_start(file: &File<'_>, other: Option<Span>) -> String {
    match other {
        None => "These overloads can be combined into one signature".to_owned(),
        Some(other) => format!(
            "This overload and the one on line {} can be combined into one signature",
            file.line_of(other.start)
        ),
    }
}

impl UnifiedSignatures {
    fn signatures_can_be_unified<'a>(
        &self,
        a: Func<'a>,
        b: Func<'a>,
        a_parameters: &[Param<'a>],
        b_parameters: &[Param<'a>],
        outer: Option<List<'a, TypeParam<'a>>>,
    ) -> bool {
        if self.ignore_differently_named_parameters
            && a_parameters.iter().zip(b_parameters).any(|(a, b)| {
                parameter_type(*a) == parameter_type(*b)
                    && get_static_parameter_name(*a) != get_static_parameter_name(*b)
            })
        {
            return false;
        }
        if self.ignore_overloads_with_different_jsdoc
            && get_block_comment_for_node(a) != get_block_comment_for_node(b)
        {
            return false;
        }
        // Must return the same type.
        types_are_equal(a.return_type(), b.return_type())
            // Must take the same type parameters.
            && a.type_params().len() == b.type_params().len()
            && a.type_params().iter().zip(b.type_params()).all(|(a, b)| type_parameters_are_equal(a, b))
            // If one uses a type parameter (from outside) and the other doesn't, they shouldn't be joined.
            && signature_uses_type_parameter(a_parameters, outer) == signature_uses_type_parameter(b_parameters, outer)
    }

    fn compare_signatures<'a>(
        &self,
        a: Func<'a>,
        b: Func<'a>,
        outer: Option<List<'a, TypeParam<'a>>>,
    ) -> Option<Unify<'a>> {
        let a_parameters: SmallVec<[Param<'a>; 8]> = a.params_with_this().collect();
        let b_parameters: SmallVec<[Param<'a>; 8]> = b.params_with_this().collect();
        if !self.signatures_can_be_unified(a, b, &a_parameters, &b_parameters, outer) {
            return None;
        }
        match a_parameters.len() == b_parameters.len() {
            true => signatures_have_same_amount_of_parameters(a, b, &a_parameters, &b_parameters),
            false => signatures_differ_by_optional_or_rest_parameter(a, b, &a_parameters, &b_parameters),
        }
    }

    fn check_overloads<'a>(
        &self,
        overloads: &[Func<'a>],
        outer: Option<List<'a, TypeParam<'a>>>,
        cx: &Cx<'a, Self>,
    ) {
        let only2 = overloads.len() == 2;
        let start = |other: Span| failure_string_start(cx, (!only2).then_some(other));
        for (i, &a) in overloads.iter().enumerate() {
            for &b in &overloads[i + 1..] {
                match self.compare_signatures(a, b, outer) {
                    None => {}
                    Some(Unify::SingleParameterDifference { p0, p1 }) => {
                        let types = get_unified_type_text(
                            get_parameter_type_annotation(p0),
                            get_parameter_type_annotation(p1),
                        );
                        cx.report(parameter_span(p1), SINGLE_PARAMETER_DIFFERENCE)
                            .data("failureStringStart", start(parameter_span(p0)))
                            .data("types", types);
                    }
                    Some(Unify::ExtraParameter {
                        extra_parameter,
                        other_signature,
                    }) => {
                        let message = match is_rest_element(extra_parameter) {
                            true => OMITTING_REST_PARAMETER,
                            false => OMITTING_SINGLE_PARAMETER,
                        };
                        cx.report(parameter_span(extra_parameter), message)
                            .data("failureStringStart", start(other_signature.estree_span()));
                    }
                    Some(Unify::AllParametersAreSame {
                        signature0,
                        signature1,
                    }) => {
                        cx.report(signature1.estree_span(), ALL_PARAMETERS_ARE_SAME)
                            .data("failureStringStart", start(signature0.estree_span()));
                    }
                }
            }
        }
    }

    /// `overloads`: what is directly in a file, a namespace, a class declaration, an interface or
    /// a type literal. `outer`: the type parameters of the class or the interface.
    fn check_scope<'a>(
        &self,
        overloads: impl Iterator<Item = Overload<'a>>,
        outer: Option<List<'a, TypeParam<'a>>>,
        cx: &Cx<'a, Self>,
    ) {
        let overloads: SmallVec<[Overload<'a>; 16]> = overloads.collect();
        let has_same_key_as_earlier =
            |(i, it): (usize, &Overload<'a>)| overloads[..i].iter().any(|earlier| earlier.key == it.key);
        if !overloads.spilled() && !overloads.iter().enumerate().any(has_same_key_as_earlier) {
            return;
        }
        let mut by_key: FxHashMap<OverloadKey<'a>, SmallVec<[Func<'a>; 4]>> = FxHashMap::default();
        for overload in &overloads {
            by_key.entry(overload.key).or_default().push(overload.signature);
        }
        for signatures in by_key.values() {
            self.check_overloads(signatures, outer, cx);
        }
    }
}

impl Rule for UnifiedSignatures {
    const META: Meta = Meta::typescript("unified-signatures", Kind::Suggestion).presets(Presets::STRICT);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        UnifiedSignatures {
            ignore_differently_named_parameters: options.bool_or("ignoreDifferentlyNamedParameters", false),
            ignore_overloads_with_different_jsdoc: options.bool_or("ignoreOverloadsWithDifferentJSDoc", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.classes(|rule, class, cx| {
            if matches!(class.owner(), Node::Stmt(_)) {
                let overloads = class.members().iter().filter_map(overload_of_member);
                rule.check_scope(overloads, Some(class.type_params()), cx);
            }
        });
        on.stmts([StmtTag::Interface, StmtTag::Module], |rule, statement, cx| match statement.kind() {
            StmtKind::Interface(interface) => {
                let overloads = interface.members().iter().filter_map(overload_of_member);
                rule.check_scope(overloads, Some(interface.type_params()), cx);
            }
            StmtKind::Module(module) => {
                rule.check_scope(module.body().iter().filter_map(overload_of_statement), None, cx);
            }
            _ => {}
        });
        on.types([TypeTag::Object], |rule, ty, cx| {
            if let TypeKind::Object(members) = ty.kind() {
                rule.check_scope(members.iter().filter_map(overload_of_member), None, cx);
            }
        });
        on.finish(|rule, cx| {
            rule.check_scope(cx.file().body().iter().filter_map(overload_of_statement), None, cx);
        });
    }
}
