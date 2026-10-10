use crate::bun::{CALLED, Exports, calls_of_modules, each_call_of_exports, exports_option};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::TraceMap;
use bun_lint_oxlint::ast_util::is_global_reference;

/// Require a request that is made with axios to have a `timeout` or a `signal`.
///
/// See `timeout` ("default is `0` (no timeout)"), `signal` and `cancelToken` in "Request Config", and "Request method
/// aliases" and "Config Defaults", in the documentation of axios.
pub struct NoUnboundedRequests {
    /// What takes what `axios` takes.
    clients: Exports,
}

const NO_TIMEOUT: Message = Message::new(
    "noTimeout",
    "axios waits for the answer for as long as it takes. Set `timeout`, or a `signal` that ends the request.",
);
const NO_LIMIT: Message = Message::new("noLimit", "`timeout: {{value}}` sets no limit.");

/// `axios()`, and its methods that take a configuration.
const AXIOS: TraceMap<'static, ()> = TraceMap::new(&[
    ("create", CALLED),
    ("delete", CALLED),
    ("get", CALLED),
    ("head", CALLED),
    ("options", CALLED),
    ("patch", CALLED),
    ("patchForm", CALLED),
    ("post", CALLED),
    ("postForm", CALLED),
    ("put", CALLED),
    ("putForm", CALLED),
    ("request", CALLED),
])
.call(());
const MODULES: TraceMap<'static, ()> = TraceMap::new(&[("axios", AXIOS)]);

/// Which of `arguments` is the configuration, if that can be told.
fn position_of_configuration<'a>(method: &str, arguments: List<'a, Expr<'a>>) -> Option<usize> {
    match method {
        "create" | "request" => Some(0),
        "delete" | "get" | "head" | "options" => Some(1),
        "patch" | "patchForm" | "post" | "postForm" | "put" | "putForm" => Some(2),
        // `axios(configuration)`, `axios(url, configuration)`
        _ => match arguments.first()?.tag() {
            ExprTag::Object => Some(0),
            ExprTag::String | ExprTag::Template => Some(1),
            _ => (arguments.len() > 1).then_some(1),
        },
    }
}

fn sets_no_limit(timeout: Expr) -> bool {
    match timeout.kind() {
        ExprKind::Number(value) => value <= 0.0 || value.is_infinite(),
        ExprKind::Ident(name) => name.is("Infinity") && is_global_reference(timeout),
        _ => false,
    }
}

/// `axios.defaults.timeout = 1000`, also of an instance.
fn sets_default_timeout(e: Expr) -> bool {
    let ExprKind::Assign { target, .. } = e.kind() else {
        return false;
    };
    matches!(target.kind(), ExprKind::Dot { obj, name, .. } if name.name().is("timeout")
        && matches!(obj.kind(), ExprKind::Dot { name, .. } if name.name().is("defaults")))
}

fn check_request<'a>(e: Expr<'a>, method: &str, cx: &Cx<'a, NoUnboundedRequests>) {
    let Some(call) = e.as_call() else {
        return;
    };
    let arguments = call.args();
    if arguments.iter().any(|it| it.tag() == ExprTag::Spread) {
        return;
    }
    let Some(position) = position_of_configuration(method, arguments) else {
        return;
    };
    let properties = match arguments.get(position).map(|it| it.skip_type_wrappers().kind()) {
        None => {
            cx.report(call.callee(), NO_TIMEOUT);
            return;
        }
        Some(ExprKind::Object(properties)) => properties,
        // What it has is not to be seen here.
        Some(_) => return,
    };
    let find = |name: &str| properties.iter().find(|it| it.key().is_some_and(|key| key.is(name)));
    let has_spread = properties.iter().any(|it| it.kind() == PropKind::Spread);
    if has_spread || find("signal").is_some() || find("cancelToken").is_some() {
        return;
    }
    match find("timeout").map(Prop::value) {
        None => {
            cx.report(call.callee(), NO_TIMEOUT);
        }
        Some(Some(timeout)) if sets_no_limit(timeout) => {
            cx.report(timeout, NO_LIMIT).data("value", timeout.text());
        }
        Some(_) => {}
    }
}

impl Rule for NoUnboundedRequests {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-unbounded-requests", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUnboundedRequests { clients: exports_option(options, "clients") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("axios") || !self.clients.is_empty()).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        if file.mentions("defaults") && file.exprs_of_kind(ExprTag::Assign).any(sets_default_timeout) {
            return;
        }
        if file.mentions("axios") {
            for (e, method) in calls_of_modules(file, &MODULES) {
                check_request(e, method, cx);
            }
        }
        each_call_of_exports(file, &self.clients, AXIOS, &mut |e, method| check_request(e, method, cx));
    }
}
