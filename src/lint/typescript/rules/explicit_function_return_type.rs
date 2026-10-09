use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ts_scope::{
    ReturnTypeOptions, ancestor_has_return_type, check_function_return_type,
    is_valid_function_expression_return_type,
};

/// Require explicit return types on functions and class methods.
pub struct ExplicitFunctionReturnType {
    allow_concise_arrow_function_expressions_starting_with_void: bool,
    allowed_names: Vec<Box<[u8]>>,
    allow_functions_without_type_parameters: bool,
    allow_iifes: bool,
    options: ReturnTypeOptions,
}

const MISSING_RETURN_TYPE: Message =
    Message::new("missingReturnType", "Missing return type on function.");

/// The name that `allowedNames` goes by: its own, or that of the variable, the method or the
/// property that it is the value of.
fn name_of(func: Func<'_>) -> Option<Name<'_>> {
    if let Some(name) = func.name() {
        return Some(name.name());
    }
    let key = match func.owner() {
        Node::Member(member) => match member.key() {
            Some(key) => key,
            None => return member.constructor_keyword().filter(|it| !it.is_string()).map(Ident::name),
        },
        Node::Expr(e) => match e.parent() {
            Node::VarDecl(declaration) => return declaration.pat().as_ident(),
            // Not an `AccessorProperty`.
            Node::Member(member)
                if member.init() == Some(e) && !member.flags().contains(Flags::ACCESSOR) =>
            {
                member.key()?
            }
            Node::Prop(prop) if !prop.is_jsx_attribute() => prop.key()?,
            _ => return None,
        },
        _ => return None,
    };
    match key.kind() {
        KeyKind::Ident(name) => Some(name),
        _ => None,
    }
}

/// typescript-eslint's `isIIFE`, which also holds for an argument of a call.
fn is_iife(func: Func) -> bool {
    matches!(func.owner(), Node::Expr(e)
        if matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Call))
}

/// oxlint's `ancestor_has_return_type`, which does not ask whether the function is returned: it is enough that it is
/// somewhere in a function with a return type, or in the value of a variable or a property with a type annotation, with
/// no statement that is an expression between.
fn oxlint_ancestor_has_return_type<'a>(func: Func<'a>, known: &mut AncestorMemo<'a, bool>) -> bool {
    let answer = known.find(Node::Func(func), |_, ancestor| match ancestor {
        Node::Func(outer) if outer.return_type().is_some() => Some(true),
        Node::VarDecl(declaration) => Some(declaration.ty().is_some()),
        Node::Member(member) if member.kind() == MemberKind::Property => Some(member.ty().is_some()),
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Expr(e) if !e.as_fn().is_some_and(Func::is_arrow) => Some(false),
            _ => None,
        },
        _ => None,
    });
    answer == Some(true)
}

/// `(a: () => void = () => {}) => {}`: for oxlint the type of the parameter says nothing about its default value.
fn oxlint_is_default_of_parameter(func: Func) -> bool {
    matches!(
        func.owner(),
        Node::Expr(e) if matches!(e.parent(), Node::Param(param) if param.default() == Some(e))
    )
}

/// The member of a class that `func` is, or is the value of.
fn member_of(func: Func<'_>) -> Option<Member<'_>> {
    match func.owner() {
        Node::Member(member) => Some(member),
        Node::Expr(e) => match e.parent() {
            Node::Member(member) if member.init() == Some(e) => Some(member),
            _ => None,
        },
        _ => None,
    }
}

impl ExplicitFunctionReturnType {
    fn is_allowed_function(&self, func: Func) -> bool {
        (self.allow_functions_without_type_parameters && func.type_params().is_empty())
            || (self.allow_iifes && is_iife(func))
            || (!self.allowed_names.is_empty()
                && name_of(func).is_some_and(|name| {
                    self.allowed_names.iter().any(|allowed| **allowed == *name.bytes())
                }))
    }

    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        // oxlint also looks at a function and at a method of a class that have no body.
        let is_oxlint = cx.language().is_oxlint;
        let is_only_declared = is_oxlint
            && !func.has_body()
            && match func.owner() {
                Node::Member(member) => {
                    matches!(func.kind(), FnKind::Method | FnKind::Getter) && matches!(member.parent(), Node::Class(_))
                }
                _ => func.kind() == FnKind::Decl,
            };
        if func.return_type().is_some() || !ast_utils::is_function_with_body(func) && !is_only_declared {
            return;
        }
        let is_expression = func.kind() != FnKind::Decl;
        if self.allow_concise_arrow_function_expressions_starting_with_void
            && func.is_arrow()
            && let FnBody::Expr(body) = func.body()
            && matches!(body.kind(), ExprKind::Unary { op: UnOp::Void, .. })
        {
            return;
        }
        if self.is_allowed_function(func) {
            return;
        }
        if is_only_declared {
            let start = match func.owner() {
                Node::Stmt(statement) => statement.span_without_export().start,
                Node::Member(member) => member.span().start,
                _ => func.span().start,
            };
            let end = func.open_paren().filter(|&it| it >= start).unwrap_or(start);
            cx.report(Span::new(start, end), MISSING_RETURN_TYPE);
            return;
        }
        if is_expression
            && self.options.allow_typed_function_expressions
            && (is_valid_function_expression_return_type(func, self.options)
                && !(is_oxlint && oxlint_is_default_of_parameter(func))
                || ancestor_has_return_type(func)
                || is_oxlint && oxlint_ancestor_has_return_type(func, &mut cx.state))
        {
            return;
        }
        check_function_return_type(func, self.options, |mut loc| {
            // oxlint points at the decorators of a member.
            if is_oxlint && let Some(member) = member_of(func) {
                loc.start = member.span().start;
            }
            cx.report(loc, MISSING_RETURN_TYPE);
        });
    }
}

impl Rule for ExplicitFunctionReturnType {
    const META: Meta = Meta::typescript("explicit-function-return-type", Kind::Problem);
    /// For oxlint: whether what is around a node has a return type.
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        ExplicitFunctionReturnType {
            allow_concise_arrow_function_expressions_starting_with_void: object
                .bool_or("allowConciseArrowFunctionExpressionsStartingWithVoid", false),
            allowed_names: (object.strings("allowedNames").into_iter())
                .map(|name| name.as_bytes().into())
                .collect(),
            allow_functions_without_type_parameters: object
                .bool_or("allowFunctionsWithoutTypeParameters", false),
            allow_iifes: object.bool_or("allowIIFEs", false),
            options: ReturnTypeOptions {
                allow_direct_const_assertion_in_arrow_functions: object
                    .bool_or("allowDirectConstAssertionInArrowFunctions", true),
                allow_expressions: object.bool_or("allowExpressions", false),
                allow_higher_order_functions: object.bool_or("allowHigherOrderFunctions", true),
                allow_typed_function_expressions: object
                    .bool_or("allowTypedFunctionExpressions", true),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        on.funcs(Self::check);
        AncestorMemo::default()
    }
}
