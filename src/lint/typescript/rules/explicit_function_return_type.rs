use bun_lint::prelude::*;
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
        if func.return_type().is_some() || !ast_utils::is_function_with_body(func) {
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
        if is_expression
            && self.options.allow_typed_function_expressions
            && (is_valid_function_expression_return_type(func, self.options)
                || ancestor_has_return_type(func))
        {
            return;
        }
        check_function_return_type(func, self.options, |loc| {
            cx.report(loc, MISSING_RETURN_TYPE);
        });
    }
}

impl Rule for ExplicitFunctionReturnType {
    const META: Meta = Meta::typescript("explicit-function-return-type", Kind::Problem);
    type State<'a> = ();

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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check);
    }
}
