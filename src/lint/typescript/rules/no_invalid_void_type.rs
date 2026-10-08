use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::{MemberAccessValue, get_static_member_access_value, has_overload_signatures, is_function_type};
use rustc_hash::{FxHashMap, FxHashSet};

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

/// typescript-eslint's `hasOverloadSignatures`, for a rule that asks it of every function of a body or every method of a class.
#[derive(Default)]
pub(crate) struct OverloadSignatures<'a> {
    /// For what has many statements: how the function declarations without a body in it are exported, and their names.
    functions: FxHashMap<Node<'a>, FxHashSet<(u32, Option<Name<'a>>)>>,
    /// For a class with many members: the names of the methods without a body.
    methods: FxHashMap<Class<'a>, FxHashSet<Option<MemberAccessValue<'a>>>>,
}

impl<'a> OverloadSignatures<'a> {
    const FEW: usize = 16;

    /// `node`: as for [`has_overload_signatures`].
    pub(crate) fn has(&mut self, node: Node<'a>) -> bool {
        let owner = match node {
            Node::Func(func) => func.owner(),
            _ => node,
        };
        match owner {
            Node::Stmt(statement) => self.has_for_function(statement).unwrap_or_else(|| has_overload_signatures(node)),
            Node::Member(member) => self.has_for_method(member).unwrap_or_else(|| has_overload_signatures(node)),
            _ => false,
        }
    }

    /// `None` where there are few statements.
    fn has_for_function(&mut self, statement: Stmt<'a>) -> Option<bool> {
        const EXPORT_DEFAULT: Flags = Flags::EXPORT.union(Flags::DEFAULT);
        // A default export has an overload in any other.
        let key = |statement: Stmt<'a>, func: Func<'a>| match statement.flags().intersection(EXPORT_DEFAULT) {
            EXPORT_DEFAULT => (EXPORT_DEFAULT.bits(), None),
            export => (export.bits(), func.name().map(|it| it.name())),
        };
        let StmtKind::Fn(func) = statement.kind() else {
            return None;
        };
        let parent = statement.parent();
        let siblings = match parent {
            Node::File(file) => file.body(),
            Node::Func(func) => func.body_statements()?,
            Node::Stmt(parent) => match parent.kind() {
                StmtKind::Block(statements) => statements,
                StmtKind::Module(module) => module.body(),
                _ => return None,
            },
            _ => return None,
        };
        if !self.functions.contains_key(&parent) && siblings.len() <= Self::FEW {
            return None;
        }
        let declared = self.functions.entry(parent).or_insert_with(|| {
            let without_body = siblings.iter().filter_map(|it| match it.kind() {
                StmtKind::Fn(func) if !func.has_body() => Some(key(it, func)),
                _ => None,
            });
            without_body.collect()
        });
        Some(declared.contains(&key(statement, func)))
    }

    /// `None` where there are few members.
    fn has_for_method(&mut self, member: Member<'a>) -> Option<bool> {
        let Node::Class(class) = member.parent() else {
            return None;
        };
        if !self.methods.contains_key(&class) && class.members().len() <= Self::FEW {
            return None;
        }
        let declared = self.methods.entry(class).or_insert_with(|| {
            let without_body = |it: &Member<'a>| !it.flags().contains(Flags::ABSTRACT) && it.func().is_some_and(is_function_type);
            class.members().iter().filter(without_body).map(get_static_member_access_value).collect()
        });
        Some(declared.contains(&get_static_member_access_value(member)))
    }
}

#[derive(Default)]
pub struct State<'a> {
    /// For a union with many members: whether `void` is valid in it.
    unions: FxHashMap<TypeNode<'a>, bool>,
    overloads: OverloadSignatures<'a>,
}

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
                    let State { unions, overloads } = &mut cx.state;
                    let mut is_valid = || {
                        members.iter().all(is_valid_union_member)
                            || parent_function_declaration(parent).is_some_and(|it| overloads.has(it))
                    };
                    let is_valid = match members.len() <= 4 {
                        true => is_valid(),
                        false => *unions.entry(union).or_insert_with(is_valid),
                    };
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
    type State<'a> = State<'a>;

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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.types([TypeTag::Keyword], Self::check);
        State::default()
    }
}
