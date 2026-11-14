//! `proxyInternals` of `bun:internal-for-testing`: the pure parts of proxy
//! resolution, so their tables of cases need neither a server nor a subprocess.

use bun_core::Utf8Bytes;
use bun_jsc::JSString;
use bun_jsc::bindgen::{self, JsHeap, JsLocal};
use bun_url::URL;

/// `noProxyMatches(list, hostname, port)`
pub(crate) fn no_proxy_matches(list: &[u8], hostname: &[u8], port: u16) -> bool {
    bun_dotenv::no_proxy::matches(list, hostname, port)
}

/// `proxyFor([name, value, name, value, ...], url)`: the proxy an environment
/// with exactly those variables selects for `url`, or null.
pub(crate) fn proxy_for<'a>(
    heap: &JsHeap<'a>,
    entries: Vec<Utf8Bytes<'static>>,
    url: &[u8],
) -> bindgen::Result<'a, Option<JsLocal<'a, JSString>>> {
    let mut env = bun_dotenv::Loader::init();
    let mut entries = entries.into_iter();
    while let Some(name) = entries.next() {
        let Some(value) = entries.next() else {
            return Err(heap.invalid_arguments(format_args!("a name without a value")));
        };
        bun_core::handle_oom(env.map.put(&name, &value));
    }
    env.get_http_proxy_for(&URL::parse(url))
        .map(|proxy| heap.create_utf8_string(proxy.href))
        .transpose()
}

/// `parseURL(href)`: what the HTTP client's URL parser makes of `href`.
pub(crate) fn parse_url(href: &[u8]) -> [(&'static [u8], &[u8]); 5] {
    let url = URL::parse(href);
    [
        (b"username", url.username),
        (b"password", url.password),
        (b"hostname", url.hostname),
        (b"port", url.port),
        (b"pathname", url.pathname),
    ]
}
