use crate::bun::{CALLED, bun_calls, has_unknown_properties, module_calls, property, value_of};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdSet;
use bun_lint::utils::eslint_utils::TraceMap;

/// Require `requestCert` on a TLS server that has a `ca`.
///
/// Not for `node:tls` and `node:https`, whose servers have never turned a client away without `requestCert`.
pub struct TlsRequireRequestCert;

const NOT_REQUESTED: &Message = &Message::new(
    "notRequested",
    "`ca` doesn't make a server ask for a client certificate. Set `requestCert` to `true` for mutual TLS, or to `false`.",
);
const REQUEST: &Message = &Message::new("request", "Add `requestCert: true`.");

const MODULES: TraceMap<'static, ()> = TraceMap::new(&[("bun", TraceMap::new(&[("listen", CALLED), ("serve", CALLED)]))]);

impl Rule for TlsRequireRequestCert {
    const META: Meta = Meta::plugin(Plugin::Bun, "tls-require-request-cert", Kind::Problem).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        TlsRequireRequestCert
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("ca").then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let calls = module_calls(file, &MODULES).into_iter().chain(bun_calls(file, &["listen", "serve"]));
        let of_calls = calls.filter_map(|it| it.0.as_call()?.args().first());
        // `export default { fetch() {}, tls: {} }` is a server too.
        let exported = file.body().iter().filter_map(|it| match it.kind() {
            StmtKind::ExportDefault(e) => {
                let properties = value_of(e).as_object()?;
                property(properties, "fetch").or_else(|| property(properties, "routes")).map(|_| e)
            }
            _ => None,
        });
        let mut checked = IdSet::new();
        let mut check = |options: Expr<'a>| {
            if let Some(properties) = value_of(options).as_object()
                && let Some(ca) = property(properties, "ca")
                && !ca.value().is_some_and(|it| it.is_ident("undefined"))
                && property(properties, "requestCert").is_none()
                && !has_unknown_properties(properties)
                && checked.insert(ca)
            {
                cx.report(ca, NOT_REQUESTED).suggest(REQUEST, |fixer| fixer.insert_after(ca, ", requestCert: true"));
            }
        };
        for options in of_calls.chain(exported) {
            check(options);
            let tls = value_of(options).as_object().and_then(|it| property(it, "tls")).and_then(Prop::value);
            match tls.map(|it| (it, value_of(it).as_array())) {
                Some((_, Some(each))) => each.iter().for_each(&mut check),
                Some((tls, None)) => check(tls),
                None => {}
            }
        }
    }
}
