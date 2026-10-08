use bun_lint::prelude::*;

/// Disallow `void` type outside of generic or return types.
pub struct NoInvalidVoidType {
    allows_this_parameter: bool,
    generics: Generics,
}

/// `allowInGenericTypeArguments`
enum Generics {
    Allowed,
    Forbidden,
    /// The names of the types that may have `void` as an argument, without spaces.
    Only(Vec<Box<[u8]>>),
}

const INVALID_VOID_FOR_GENERIC: Message = Message::new(
    "invalidVoidForGeneric",
    "{{ generic }} may not have void as a type argument.",
);
const INVALID_VOID_NOT_RETURN: Message =
    Message::new("invalidVoidNotReturn", "void is only valid as a return type.");
const INVALID_VOID_NOT_RETURN_OR_GENERIC: Message = Message::new(
    "invalidVoidNotReturnOrGeneric",
    "void is only valid as a return type or generic type argument.",
);
const INVALID_VOID_NOT_RETURN_OR_THIS_PARAM: Message = Message::new(
    "invalidVoidNotReturnOrThisParam",
    "void is only valid as return type or type of `this` parameter.",
);
const INVALID_VOID_NOT_RETURN_OR_THIS_PARAM_OR_GENERIC: Message = Message::new(
    "invalidVoidNotReturnOrThisParamOrGeneric",
    "void is only valid as a return type or generic type argument or the type of a `this` parameter.",
);
const INVALID_VOID_UNION_CONSTITUENT: Message = Message::new(
    "invalidVoidUnionConstituent",
    "void is not valid as a constituent in a union type",
);

fn is_void(ty: TypeNode) -> bool {
    ty.is_keyword(Keyword::Void)
}

fn without_spaces(text: &[u8]) -> impl Iterator<Item = u8> + '_ {
    text.iter().copied().filter(|byte| *byte != b' ')
}

/// `void`, `never`, or any `T<.., void, ..>`, which is checked where the `void` in it is.
fn is_valid_union_member(member: TypeNode) -> bool {
    match member.kind() {
        TypeKind::Keyword(Keyword::Void | Keyword::Never) => true,
        TypeKind::Ref { args, .. } => args.iter().any(is_void),
        _ => false,
    }
}

/// typescript-eslint's `getParentFunctionDeclarationNode`: the innermost function declaration or
/// method of a class around `node` that has a body.
fn parent_function_declaration(node: Node<'_>) -> Option<Node<'_>> {
    node.ancestors().find(|ancestor| match *ancestor {
        Node::Func(func) => func.kind() == FnKind::Decl && func.has_body(),
        Node::Member(member) => {
            utils::estree_type_name(*ancestor) == "MethodDefinition"
                && member.func().is_some_and(Func::has_body)
        }
        _ => false,
    })
}

impl NoInvalidVoidType {
    /// `ty` is an argument of `reference`.
    fn check_generic_type_argument<'a>(
        &self,
        ty: TypeNode<'a>,
        reference: TypeNode<'a>,
        cx: &mut Cx<'a, Self>,
    ) {
        match &self.generics {
            Generics::Allowed => {}
            Generics::Forbidden => {
                cx.report(ty, match self.allows_this_parameter {
                    true => INVALID_VOID_NOT_RETURN_OR_THIS_PARAM,
                    false => INVALID_VOID_NOT_RETURN,
                });
            }
            Generics::Only(allowed) => {
                let TypeKind::Ref { name, .. } = reference.kind() else {
                    return;
                };
                let written = cx.slice(name.span());
                if !allowed.iter().any(|it| without_spaces(written).eq(it.iter().copied())) {
                    cx.report(ty, INVALID_VOID_FOR_GENERIC)
                        .data("generic", without_spaces(written).collect::<Vec<u8>>());
                }
            }
        }
    }

    /// Whether `void` is valid as the type annotation or as a type argument of `parent`.
    fn is_valid_in(&self, parent: Node) -> bool {
        let as_type_argument = matches!(self.generics, Generics::Allowed);
        match parent {
            // A return type.
            Node::Func(_) => true,
            // The annotation of an identifier is invalid, that of any other pattern is not.
            Node::Param(param) => param.is_rest() || param.pat().tag() != PatTag::Ident,
            Node::VarDecl(declaration) => declaration.pat().tag() != PatTag::Ident,
            Node::Member(_) => matches!(
                utils::estree_type_name(parent),
                "TSAbstractPropertyDefinition" | "TSAbstractAccessorProperty"
            ),
            Node::Class(_) => as_type_argument,
            Node::Expr(e) => match e.kind() {
                ExprKind::New(_)
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Instantiation { .. }
                | ExprKind::Jsx(_) => as_type_argument,
                _ => false,
            },
            Node::Type(ty) => match ty.kind() {
                TypeKind::Predicate { .. } => true,
                TypeKind::Ref { .. }
                | TypeKind::Heritage { .. }
                | TypeKind::Import { .. }
                | TypeKind::Typeof { .. } => as_type_argument,
                _ => false,
            },
            _ => false,
        }
    }

    fn check<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if !is_void(ty) {
            return;
        }
        let parent = ty.parent();
        let allows_generics = !matches!(self.generics, Generics::Forbidden);
        let mut is_in_union = false;
        match parent {
            Node::Type(reference)
                if reference.tag() == TypeTag::Ref
                    && utils::estree_type_name(parent) == "TSTypeReference" =>
            {
                return self.check_generic_type_argument(ty, reference, cx);
            }
            Node::Type(union) => {
                if let TypeKind::Union(members) = union.kind() {
                    is_in_union = true;
                    if members.iter().all(is_valid_union_member)
                        || parent_function_declaration(parent)
                            .is_some_and(ts_utils::has_overload_signatures)
                    {
                        return;
                    }
                }
            }
            // `<T = void>` is a use in a generic type. `<T extends void = void>` is not.
            Node::TypeParam(param) if allows_generics && param.default().is_some_and(is_void) => {
                if param.default() != Some(ty) {
                    cx.report(ty, INVALID_VOID_NOT_RETURN_OR_GENERIC);
                }
                return;
            }
            Node::Param(param)
                if self.allows_this_parameter
                    && !param.is_rest()
                    && param.pat().as_ident().is_some_and(|name| name.is("this")) =>
            {
                return;
            }
            _ => {}
        }
        if self.is_valid_in(parent) {
            return;
        }
        cx.report(ty, match (allows_generics, self.allows_this_parameter) {
            (true, true) => INVALID_VOID_NOT_RETURN_OR_THIS_PARAM_OR_GENERIC,
            (true, false) if is_in_union => INVALID_VOID_UNION_CONSTITUENT,
            (true, false) => INVALID_VOID_NOT_RETURN_OR_GENERIC,
            (false, true) => INVALID_VOID_NOT_RETURN_OR_THIS_PARAM,
            (false, false) => INVALID_VOID_NOT_RETURN,
        });
    }
}

impl Rule for NoInvalidVoidType {
    const META: Meta =
        Meta::typescript("no-invalid-void-type", Kind::Problem).presets(Presets::STRICT);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let key = "allowInGenericTypeArguments";
        NoInvalidVoidType {
            allows_this_parameter: object.bool_or("allowAsThisParameter", false),
            generics: match object.bool(key) {
                Some(false) => Generics::Forbidden,
                None if object.has(key) => {
                    let names = object.strings(key).into_iter();
                    Generics::Only(names.map(|it| without_spaces(it.as_bytes()).collect()).collect())
                }
                _ => Generics::Allowed,
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.types([TypeTag::Keyword], Self::check);
    }
}
