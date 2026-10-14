//! `proxyInternals` of `bun:internal-for-testing`: the pure parts of proxy
//! resolution, so their tables of cases need neither a server nor a subprocess.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, bun_string_jsc};
use bun_url::URL;

/// `noProxyMatches(list, hostname, port)`
pub(crate) fn no_proxy_matches(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let list = frame.argument(0).to_utf8(global)?;
    let hostname = frame.argument(1).to_utf8(global)?;
    let port = frame.argument(2).to_int32();
    let Ok(port) = u16::try_from(port) else {
        return Err(global.throw_invalid_arguments(format_args!("port must be a u16")));
    };
    Ok(JSValue::js_boolean(bun_dotenv::no_proxy::matches(
        &list, &hostname, port,
    )))
}

/// `proxyFor([name, value, name, value, ...], url)`: the proxy an environment
/// with exactly those variables selects for `url`, or null.
pub(crate) fn proxy_for(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let mut env = bun_dotenv::Loader::init();
    let mut entries = frame.argument(0).array_iterator(global)?;
    while let Some(name) = entries.next()? {
        let Some(value) = entries.next()? else {
            return Err(global.throw_invalid_arguments(format_args!("a name without a value")));
        };
        bun_core::handle_oom(env.map.put(&name.to_utf8(global)?, &value.to_utf8(global)?));
    }
    let href = frame.argument(1).to_utf8(global)?;
    match env.get_http_proxy_for(&URL::parse(&href)) {
        Some(proxy) => bun_string_jsc::create_utf8_for_js(global, proxy.href),
        None => Ok(JSValue::NULL),
    }
}

/// `parseURL(href)`: what the HTTP client's URL parser makes of `href`.
pub(crate) fn parse_url(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let href = frame.argument(0).to_utf8(global)?;
    let url = URL::parse(&href);
    let object = JSValue::create_empty_object(global, 5);
    for (name, value) in [
        (&b"username"[..], url.username),
        (b"password", url.password),
        (b"hostname", url.hostname),
        (b"port", url.port),
        (b"pathname", url.pathname),
    ] {
        object.put(
            global,
            name,
            bun_string_jsc::create_utf8_for_js(global, value)?,
        );
    }
    Ok(object)
}
