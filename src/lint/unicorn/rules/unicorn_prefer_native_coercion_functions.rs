use bun_lint_oxlint::ast_util::{as_member_expression, get_inner_expression, static_property_name};
use crate::unicorn::get_first_parameter_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefers built-in functions over custom ones with the same functionality.
pub struct PreferNativeCoercionFunctions;

const FUNCTION: Message =
    Message::new("", "The function is equivalent to `{{called_fn}}`. Call `{{called_fn}}` directly.");
const ARRAY_CALLBACK: Message = Message::new(
    "",
    "The arrow function in the callback of the array is equivalent to `Boolean`. Replace the callback with `Boolean`.",
);

const NATIVE_COERCION_FUNCTION_NAMES: [&str; 5] = ["BigInt", "Boolean", "Number", "String", "Symbol"];

const ARRAY_METHODS_WITH_BOOLEAN_CALLBACK: [&str; 7] =
    ["every", "filter", "find", "findIndex", "findLast", "findLastIndex", "some"];

/// The statements of the body, without the directives.
fn statements(func: Func<'_>) -> impl Iterator<Item = Stmt<'_>> {
    func.body_statements().into_iter().flatten().filter(|it| it.directive().is_none())
}

/// The `String` of `String(first_arg_name)`.
fn is_matching_native_coercion_function_call<'a>(e: Expr<'a>, first_arg_name: Name<'a>) -> Option<Name<'a>> {
    let call = e.as_call().filter(|it| it.chain() == Chain::No && !e.is_parenthesized())?;
    let (callee, argument) = (call.callee(), call.args().first()?);
    let fn_name = callee.as_ident().filter(|it| it.is_any(&NATIVE_COERCION_FUNCTION_NAMES))?;
    let is_matching =
        argument.as_ident() == Some(first_arg_name) && !argument.is_parenthesized() && !callee.is_parenthesized();
    is_matching.then_some(fn_name)
}

/// The same for a body that is `{ return String(first_parameter) }`.
fn check_function(func: Func<'_>) -> Option<Name<'_>> {
    let first_parameter_name = get_first_parameter_name(func)?;
    let mut statements = statements(func);
    match (statements.next()?.kind(), statements.next()) {
        (StmtKind::Return(Some(argument)), None) => {
            is_matching_native_coercion_function_call(argument, first_parameter_name)
        }
        _ => None,
    }
}

/// The `a` of `return a`, in however many blocks that have nothing else.
fn get_returned_ident(mut stmt: Stmt<'_>) -> Option<Name<'_>> {
    loop {
        match stmt.kind() {
            StmtKind::Block(body) if body.len() == 1 => stmt = body.first()?,
            StmtKind::Return(argument) => return get_inner_expression(argument?).as_ident(),
            _ => return None,
        }
    }
}

/// `array.some(arrow)`
fn is_array_callback(arrow: Expr) -> bool {
    let Node::Expr(parent) = arrow.parent() else {
        return false;
    };
    !arrow.is_parenthesized()
        && parent.as_call().is_some_and(|call| {
            call.args().first() == Some(arrow)
                && !call.is_optional()
                && as_member_expression(call.callee())
                    .filter(|it| !it.is_optional())
                    .and_then(static_property_name)
                    .is_some_and(|it| it.is_any(&ARRAY_METHODS_WITH_BOOLEAN_CALLBACK))
        })
}

impl Rule for PreferNativeCoercionFunctions {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-native-coercion-functions", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferNativeCoercionFunctions
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(|_, func, cx| {
            if func.is_async()
                || func.is_generator()
                || !func.has_body()
                || func.params().first().is_none_or(|it| it.is_rest())
                || func.return_type().is_some_and(|it| it.tag() == TypeTag::Predicate && !it.is_parenthesized())
            {
                return;
            }
            let owner = func.owner();
            if !func.is_arrow() {
                // Not what is directly in a property of an object: a method, or a value.
                let is_in_object_property =
                    matches!(owner, Node::Expr(e) if !e.is_parenthesized() && matches!(e.parent(), Node::Prop(_)));
                if !is_in_object_property && let Some(called_fn) = check_function(func) {
                    cx.report(func.estree_span(), FUNCTION).data("called_fn", called_fn);
                }
                return;
            }
            let (called_fn, returned_ident) = match func.body() {
                FnBody::Expr(body) => (
                    get_first_parameter_name(func).and_then(|it| is_matching_native_coercion_function_call(body, it)),
                    get_inner_expression(body).as_ident(),
                ),
                _ => (check_function(func), statements(func).next().and_then(get_returned_ident)),
            };
            if let Some(called_fn) = called_fn {
                cx.report(func.estree_span(), FUNCTION).data("called_fn", called_fn);
            }
            if returned_ident.is_some()
                && returned_ident == get_first_parameter_name(func)
                && matches!(owner, Node::Expr(arrow) if is_array_callback(arrow))
            {
                cx.report(func.estree_span(), ARRAY_CALLBACK);
            }
        });
    }
}
