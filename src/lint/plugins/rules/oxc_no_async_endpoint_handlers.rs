use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows the use of `async` functions as Express endpoint handlers.
pub struct NoAsyncEndpointHandlers {
    allowed_names: Vec<String>,
}

const NO_ASYNC_HANDLERS: Message = Message::new("", "Express endpoint handler should not be `async`.");
const NO_ASYNC_HANDLERS_FOR: Message = Message::new("", "Express endpoint handler for `{{endpoint}}` should not be `async`.");

#[derive(Default)]
pub struct State {
    /// Looked for at the first call that may register something.
    has_async_functions: Option<bool>,
}

impl Rule for NoAsyncEndpointHandlers {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "no-async-endpoint-handlers", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = State;

    fn new(options: &Options) -> Self {
        let allowed_names = options.object(0).strings("allowedNames").into_iter().map(String::from).collect();
        NoAsyncEndpointHandlers { allowed_names }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some((endpoint, args)) = e.as_call().and_then(as_endpoint_registration) else {
            return;
        };
        let file = cx.file();
        if !*cx.state.has_async_functions.get_or_insert_with(|| file.funcs().any(Func::is_async)) {
            return;
        }
        for arg in args.filter(|it| it.tag() != ExprTag::Spread) {
            self.check_endpoint_arg(endpoint, arg, cx);
        }
    }
}

impl NoAsyncEndpointHandlers {
    fn check_endpoint_arg<'a>(&self, endpoint: Option<Name<'a>>, arg: Expr<'a>, cx: &Cx<'a, Self>) {
        let mut at = get_inner_expression(arg);
        let mut registered_at = None;
        // Not further than anybody writes it: `const a = b, b = a` goes in a circle, and of `const b = a, c = b ..` each can be registered.
        let mut steps = 0;
        let handler = loop {
            match at.kind() {
                ExprKind::Ident(_) => {
                    registered_at.get_or_insert_with(|| at.span());
                    let Some(declaration) = at.symbol().and_then(|it| it.declarations().next()) else {
                        return;
                    };
                    let declarator = match (declaration, declaration.node()) {
                        (Declaration::Fn(func), _) => break func,
                        (Declaration::Var(_), Some(Node::VarDecl(declarator))) => declarator,
                        _ => return,
                    };
                    // What is in parentheses is neither an identifier nor a function for oxlint.
                    let Some(init) = declarator.init().filter(|it| !it.is_parenthesized()) else {
                        return;
                    };
                    steps += 1;
                    if steps > 32 || init.as_ident().is_some_and(|name| declarator.pat().as_ident() == Some(name)) {
                        return;
                    }
                    at = init;
                }
                ExprKind::Fn(func) if is_endpoint_handler(func) => break func,
                _ => return,
            }
        };
        if !handler.is_async() || handler.name().is_some_and(|name| self.allowed_names.iter().any(|it| name.name().is(it))) {
            return;
        }
        let start = handler.estree_span().start;
        let report = match endpoint {
            Some(endpoint) => cx.report(Span::new(start, start + 5), NO_ASYNC_HANDLERS_FOR).data("endpoint", endpoint),
            None => cx.report(Span::new(start, start + 5), NO_ASYNC_HANDLERS),
        };
        let report = report.labels_with(|labels| {
            let name = handler.name().map(|it| format!(" '{}'", bstr::BStr::new(it.name().bytes())));
            let name = name.unwrap_or_default();
            let Some(registered_at) = registered_at else {
                return labels.first(format!("Async handler{name} is used here"));
            };
            let route = endpoint.map(|it| format!(" for route `{}`", bstr::BStr::new(it.bytes()))).unwrap_or_default();
            labels.first(format!("Async handler{name} is declared here"));
            labels.push(registered_at, format!("and is registered here{route}"));
        });
        if let Some(registered_at) = registered_at {
            report.comments_apply_at(registered_at);
        }
    }
}

/// Sorted.
const ROUTER_HANDLER_METHOD_NAMES: [&[u8]; 9] = [b"all", b"delete", b"get", b"head", b"options", b"patch", b"post", b"put", b"use"];

/// Whether the call registers an endpoint handler or middleware to a route or an Express application object: the path, if it is
/// written there, and the arguments after it.
fn as_endpoint_registration(call: Call<'_>) -> Option<(Option<Name<'_>>, ListIter<'_, Expr<'_>>)> {
    let callee = call.callee();
    let method_name = static_property_name(callee).filter(|_| !callee.is_parenthesized())?;
    ROUTER_HANDLER_METHOD_NAMES.binary_search(&method_name.bytes()).ok()?;
    let mut args = call.args().iter();
    let first = call.args().first().filter(|it| it.tag() != ExprTag::Spread)?;
    let path = match first.kind() {
        _ if first.is_parenthesized() => None,
        ExprKind::String(path) => Some(path),
        ExprKind::Template(template) => Some(template.as_static()?),
        _ => None,
    };
    if path.is_some() {
        args.next();
    }
    Some((path, args))
}

/// Whether a function expression or an arrow function has the parameters of an endpoint handler.
fn is_endpoint_handler(func: Func) -> bool {
    let params = func.params();
    if params.len() > 4 || params.last().is_some_and(Param::is_rest) {
        return false;
    }
    let is = |index: usize, names: &[&str]| {
        params.get(index).and_then(|it| it.pat().as_ident()).is_some_and(|name| name.is_any(names))
    };
    let is_req_param = |index| is(index, &["r", "req", "request"]);
    let is_res_param = |index| is(index, &["s", "res", "response"]);
    let is_next_param = |index| is(index, &["n", "next"]);
    let is_error_param = |index| is(index, &["e", "err", "error", "exception"]);
    match params.len() {
        1 => is_req_param(0),
        2 => is_req_param(0) && is_res_param(1),
        3 => is_req_param(0) && is_res_param(1) && is_next_param(2) || is_error_param(0) && is_req_param(1) && is_res_param(2),
        4 => is_error_param(0) && is_req_param(1) && is_res_param(2) && is_next_param(3),
        _ => false,
    }
}
