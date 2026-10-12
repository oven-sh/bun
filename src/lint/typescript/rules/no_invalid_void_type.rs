use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ts_utils::has_overload_signatures;

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

fn is_this_parameter(param: Param) -> bool {
    !param.is_rest() && param.pat().as_ident().is_some_and(|name| name.is("this"))
}

fn without_spaces(text: &[u8]) -> impl Iterator<Item = u8> + '_ {
    text.iter().copied().filter(|byte| *byte != b' ')
}

/// `void`, `never`, or any `T<.., void, ..>`, which is checked where the `void` in it is. For oxlint not in parentheses.
fn is_valid_union_member(member: TypeNode) -> bool {
    let is_oxlint = member.file().language().is_oxlint;
    let is_bare = |ty: TypeNode| !(is_oxlint && ty.is_parenthesized());
    is_bare(member)
        && match member.kind() {
            TypeKind::Keyword(Keyword::Void | Keyword::Never) => true,
            TypeKind::Ref { args, .. } => args.iter().any(|it| is_void(it) && is_bare(it)),
            _ => false,
        }
}

/// typescript-eslint's `getParentFunctionDeclarationNode`: the innermost function declaration or
/// method of a class around `node` that has a body. For oxlint the innermost function with a body that is no arrow
/// function.
fn parent_function_declaration<'a>(node: Node<'a>, known: &mut AncestorMemo<'a, Node<'a>>) -> Option<Node<'a>> {
    let is_oxlint = node.file().language().is_oxlint;
    let is_one = |ancestor: Node<'a>| match ancestor {
        Node::Func(func) if is_oxlint => {
            func.has_body() && !matches!(func.kind(), FnKind::Arrow | FnKind::StaticBlock)
        }
        _ if is_oxlint => false,
        Node::Func(func) => func.kind() == FnKind::Decl && func.has_body(),
        Node::Member(member) => {
            utils::estree_type_name(ancestor) == "MethodDefinition"
                && member.func().is_some_and(Func::has_body)
        }
        _ => false,
    };
    known.find(node, |_, ancestor| is_one(ancestor).then_some(ancestor))
}

/// oxlint's `has_function_overload_signatures`: a declaration without a body, of the same name and exported in the same
/// way, among the statements that `func` is one of, or among those around them.
fn oxlint_function_has_overload_signatures<'a>(func: Func<'a>) -> bool {
    const EXPORT_DEFAULT: Flags = Flags::EXPORT.union(Flags::DEFAULT);
    let export = match func.owner() {
        Node::Stmt(statement) => statement.flags().intersection(EXPORT_DEFAULT),
        _ => Flags::empty(),
    };
    let name = func.name().map(Ident::name);
    let is_signature = |statement: Stmt<'a>| {
        statement.as_fn().is_some_and(|other| {
            !other.has_body()
                && statement.flags().intersection(EXPORT_DEFAULT) == export
                && match (name, other.name()) {
                    (Some(name), Some(other)) => name == other.name(),
                    (None, None) => export == EXPORT_DEFAULT,
                    _ => false,
                }
        })
    };
    Node::Func(func).ancestors().any(|ancestor| {
        let statements = match ancestor {
            Node::File(file) => Some(file.body()),
            Node::Func(around) if around.kind() != FnKind::StaticBlock => around.body_statements(),
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Block(statements) => Some(statements),
                StmtKind::Module(module) => Some(module.innermost().body()),
                _ => None,
            },
            _ => None,
        };
        statements.is_some_and(|it| it.iter().any(is_signature))
    })
}

/// oxlint's `has_method_overload_signatures`: another method without a body whose key is written in the same way.
fn oxlint_method_has_overload_signatures<'a>(member: Member<'a>) -> bool {
    let Node::Class(class) = member.parent() else {
        return false;
    };
    let file = member.file();
    let key = |it: Member<'a>| match it.key() {
        Some(key) => Some(file.slice(key.inner_span(file))),
        None => it.constructor_keyword().map(|keyword| file.slice(keyword.span())),
    };
    class.members().iter().any(|other| {
        other != member
            && other.func().is_some_and(|it| !it.has_body())
            && other.is_static() == member.is_static()
            && (key(other).zip(key(member))).is_some_and(|(a, b)| without_spaces(a).eq(without_spaces(b)))
    })
}

impl NoInvalidVoidType {
    /// `ty` is an argument of the type or the class `name`.
    fn check_generic_type_argument<'a>(&self, ty: TypeNode<'a>, name: Option<Span>, cx: &mut Cx<'a, Self>) {
        match &self.generics {
            Generics::Allowed => {}
            Generics::Forbidden => {
                cx.report(ty, match self.allows_this_parameter {
                    true => INVALID_VOID_NOT_RETURN_OR_THIS_PARAM,
                    false => INVALID_VOID_NOT_RETURN,
                });
            }
            Generics::Only(allowed) => {
                let Some(name) = name else {
                    return;
                };
                let written = cx.slice(name);
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

    fn report<'a>(&self, ty: TypeNode<'a>, is_in_union: bool, cx: &mut Cx<'a, Self>) {
        let allows_generics = !matches!(self.generics, Generics::Forbidden);
        cx.report(ty, match (allows_generics, self.allows_this_parameter) {
            (true, true) => INVALID_VOID_NOT_RETURN_OR_THIS_PARAM_OR_GENERIC,
            (true, false) if is_in_union => INVALID_VOID_UNION_CONSTITUENT,
            (true, false) => INVALID_VOID_NOT_RETURN_OR_GENERIC,
            (false, true) => INVALID_VOID_NOT_RETURN_OR_THIS_PARAM,
            (false, false) => INVALID_VOID_NOT_RETURN,
        });
    }

    /// oxlint's rule, which knows the places where `void` is valid: all others are not, and none is in parentheses.
    fn check_as_oxlint<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let parent = ty.parent();
        match parent {
            _ if ty.is_parenthesized() => {}
            Node::Type(reference) if reference.tag() == TypeTag::Ref => {
                let name = reference.as_ref().map(|(name, _)| name.span());
                return self.check_generic_type_argument(ty, name, cx);
            }
            Node::Class(class) => {
                return self.check_generic_type_argument(ty, class.extends().map(Expr::outer_span), cx);
            }
            Node::Expr(e) if e.tag() == ExprTag::New && !matches!(self.generics, Generics::Only(_)) => {
                return self.check_generic_type_argument(ty, None, cx);
            }
            Node::TypeParam(param) if !matches!(self.generics, Generics::Forbidden) => {
                if param.default() != Some(ty) {
                    cx.report(ty, INVALID_VOID_NOT_RETURN_OR_GENERIC);
                }
                return;
            }
            Node::Type(union) => {
                if let TypeKind::Union(members) = union.kind() {
                    // The overloads count for the return type only.
                    let is_valid = members.iter().all(is_valid_union_member)
                        || matches!(parent_function_declaration(parent, &mut cx.state), Some(Node::Func(func))
                            if func.return_type().is_some_and(|it| it.outer_span().contains(union.span()))
                                && match func.owner() {
                                    Node::Member(member) => oxlint_method_has_overload_signatures(member),
                                    _ => oxlint_function_has_overload_signatures(func),
                                });
                    if is_valid {
                        return;
                    }
                    return self.report(ty, true, cx);
                }
            }
            Node::Param(param) if self.allows_this_parameter && is_this_parameter(param) => return,
            Node::Func(func) if func.kind() != FnKind::IndexSignature => return,
            _ => {}
        }
        self.report(ty, false, cx);
    }
}

impl Rule for NoInvalidVoidType {
    const META: Meta =
        Meta::typescript("no-invalid-void-type", Kind::Problem).presets(Presets::STRICT);
    const ON: On = On::new().types(&[TypeTag::Keyword]);
    type State<'a> = AncestorMemo<'a, Node<'a>>;

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

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if !is_void(ty) {
            return;
        }
        if cx.language().is_oxlint {
            return self.check_as_oxlint(ty, cx);
        }
        let parent = ty.parent();
        let allows_generics = !matches!(self.generics, Generics::Forbidden);
        let mut is_in_union = false;
        match parent {
            Node::Type(reference)
                if reference.tag() == TypeTag::Ref
                    && utils::estree_type_name(parent) == "TSTypeReference" =>
            {
                let name = reference.as_ref().map(|(name, _)| name.span());
                return self.check_generic_type_argument(ty, name, cx);
            }
            Node::Type(union) => {
                if let TypeKind::Union(members) = union.kind() {
                    is_in_union = true;
                    let is_valid = members.iter().all(is_valid_union_member)
                        || parent_function_declaration(parent, &mut cx.state).is_some_and(has_overload_signatures);
                    if is_valid {
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
            Node::Param(param) if self.allows_this_parameter && is_this_parameter(param) => return,
            _ => {}
        }
        if !self.is_valid_in(parent) {
            self.report(ty, is_in_union, cx);
        }
    }
}
