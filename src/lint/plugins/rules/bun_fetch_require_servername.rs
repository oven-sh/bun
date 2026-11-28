use crate::bun::{has_unknown_properties, property, static_prefix, value_of};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::is_global_reference;

/// Require `tls.servername` on an HTTPS `fetch()` that sets the `Host` header.
pub struct FetchRequireServername;

const NOT_THE_SERVER_NAME: &Message = &Message::new(
    "notTheServerName",
    "The certificate is checked against the URL, not against this header. Set `tls.servername` to check another name.",
);

/// The `Host` in `{ Host: "a" }` and `new Headers({ Host: "a" })`.
fn host_header(headers: Expr<'_>) -> Option<Prop<'_>> {
    let headers = value_of(headers);
    let headers = match headers.as_new() {
        Some(it) if it.callee().is_ident("Headers") => value_of(it.args().first()?),
        _ => headers,
    };
    let is_host = |it: &Prop| it.key().and_then(Key::name).is_some_and(|it| it.bytes().eq_ignore_ascii_case(b"host"));
    headers.as_object()?.iter().find(is_host)
}

/// `a` for `a:443/b`
fn hostname(authority: &[u8]) -> &[u8] {
    strings::split_any(authority, b":/?#").next().unwrap_or_default()
}

impl Rule for FetchRequireServername {
    const META: Meta = Meta::plugin(Plugin::Bun, "fetch-require-servername", Kind::Problem);
    const ON: On = On::new().function_calls(&["fetch"]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        FetchRequireServername
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions_any(&["Host", "host", "HOST"]).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| it.callee().is_ident("fetch")) else {
            return;
        };
        let (Some(url), Some(options)) = (call.args().first(), call.args().get(1).and_then(|it| value_of(it).as_object())) else {
            return;
        };
        let Some(host) = property(options, "headers").and_then(Prop::value).and_then(host_header) else {
            return;
        };
        let tls = property(options, "tls");
        let is_settled = |tls: Prop<'a>| {
            tls.value().and_then(|it| value_of(it).as_object()).is_none_or(|it| {
                has_unknown_properties(it)
                    || ["servername", "serverName", "checkServerIdentity"].iter().any(|name| property(it, name).is_some())
                    || property(it, "rejectUnauthorized").and_then(Prop::value).is_some_and(|it| it.tag() == ExprTag::False)
            })
        };
        let is_other_name = match static_prefix(value_of(url)).filter(|it| !it.0.is_empty()) {
            Some((url, _)) => url.strip_prefix(b"https://").is_some_and(|authority| {
                let host = host.value().and_then(|it| static_prefix(value_of(it)));
                !host.is_some_and(|it| hostname(it.0).eq_ignore_ascii_case(hostname(authority)) && it.1)
            }),
            None => tls.is_some(),
        };
        if is_other_name && !has_unknown_properties(options) && !tls.is_some_and(is_settled) && is_global_reference(call.callee()) {
            cx.report(host, NOT_THE_SERVER_NAME);
        }
    }
}
