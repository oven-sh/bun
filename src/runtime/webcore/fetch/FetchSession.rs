//! `Bun.FetchSession`: connection settings shared by the `fetch()` calls that
//! name it (`fetch(url, { session })`), and the keep-alive pool they share.

use core::cell::Cell;
use core::sync::atomic::{AtomicU64, Ordering};

use bun_core::Tag as BunStringTag;
use bun_http::{self as http, Headers};
use bun_http_jsc::headers_jsc::from_fetch_headers;
use bun_jsc::bindgen::{JsLocal, JsScope, JsStructure, JsWrapper};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, JSGlobalObject, JSValue, JsCell, JsCellRefExt as _, JsError, JsRef, JsResult,
    URLJsc as _,
};
use bun_ptr::RefPtr;

use crate::socket::ssl_config::{SSLConfig, SSLConfigFromJs as _};
use crate::webcore::response::HeadersRef;

pub(crate) use crate::generated_bindgen::fetch_session::js_FetchSession as js;
use crate::generated_bindgen::fetch_session::{
    CheckServerIdentity, FetchKeepAlive, FetchSessionInit, FetchTLS, FlagOrNumber, IdleTimeout,
    ProxyHeaders, ProxyInit, UnixPath,
};

/// `proxy` as given to `fetch()` or to a session. Absent means "inherit".
#[derive(Clone)]
pub(crate) enum ProxyOption {
    /// `proxy: false`: connect directly, whatever the environment says.
    Direct,
    Explicit {
        href: Box<[u8]>,
        headers: Option<Headers>,
        /// `false` sends every request through the proxy, `NO_PROXY` or not.
        respect_no_proxy: bool,
    },
}

/// `tls` as given to `fetch()` or to a session.
pub(crate) struct TlsOption {
    pub(crate) ssl_config: Option<http::ssl_config::SharedPtr>,
    pub(crate) reject_unauthorized: Option<bool>,
    pub(crate) check_server_identity: Option<JSValue>,
}

pub(crate) fn parse_tls(
    vm: &VirtualMachine,
    global: &JSGlobalObject,
    tls: FetchTLS<'_>,
) -> JsResult<TlsOption> {
    let mut parsed = TlsOption {
        ssl_config: None,
        reject_unauthorized: None,
        check_server_identity: None,
    };
    parsed.reject_unauthorized = tls.reject_unauthorized(global)?.to_bool();
    match tls.check_server_identity(global)? {
        CheckServerIdentity::Missing => {}
        CheckServerIdentity::Callback(callback) => {
            parsed.check_server_identity = Some(callback.to_js());
        }
        CheckServerIdentity::Other(callback) => {
            return Err(global.throw_invalid_property_type_value(
                b"tls.checkServerIdentity",
                b"function",
                callback.to_js(),
            ));
        }
    }
    if let Some(config) = SSLConfig::from_js(vm, global, tls.object().to_js(), false)? {
        parsed.ssl_config = Some(http::ssl_config::global_registry::intern(config));
    }
    Ok(parsed)
}

impl FlagOrNumber<'_> {
    pub(crate) fn to_bool(self) -> Option<bool> {
        match self {
            FlagOrNumber::Flag(flag) => Some(flag),
            FlagOrNumber::Number(number) => Some(number.to_js().to_int32() != 0),
            FlagOrNumber::Other => None,
        }
    }
}

fn proxy_href(global: &JSGlobalObject, value: JSValue) -> JsResult<Box<[u8]>> {
    let href = jsc::URL::href_from_js(value, global)?;
    if href.tag() == BunStringTag::Dead {
        return Err(global
            .err(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!("fetch() proxy URL is invalid"),
            )
            .throw());
    }
    Ok(href.to_owned_slice().into_boxed_slice())
}

fn invalid_proxy(global: &JSGlobalObject, proxy_arg: JSValue) -> JsError {
    global.throw_invalid_argument_type_value2(
        "proxy",
        "a string, a URL, an object with a \"url\", or false",
        proxy_arg,
    )
}

/// What a `proxy` value says.
pub(crate) enum ProxyArg<'a> {
    /// `undefined`, `null` or `""`: the caller's default applies.
    Absent,
    /// Names no proxy, such as a number or an object without `url`.
    Unusable(JsLocal<'a>),
    Policy(ProxyOption),
}

pub(crate) fn parse_proxy<'a>(
    global: &JSGlobalObject,
    proxy_arg: ProxyInit<'a>,
) -> JsResult<ProxyArg<'a>> {
    let explicit = |proxy_arg: JSValue| -> JsResult<ProxyArg<'a>> {
        Ok(ProxyArg::Policy(ProxyOption::Explicit {
            href: proxy_href(global, proxy_arg)?,
            headers: None,
            respect_no_proxy: true,
        }))
    };
    let string = |proxy_arg: JSValue| {
        if proxy_arg.get_length(global)? > 0 {
            explicit(proxy_arg)
        } else {
            Ok(ProxyArg::Absent)
        }
    };
    let proxy_arg = match proxy_arg {
        // `true` names no proxy; treating it as "inherit" would go direct
        // wherever the environment has none.
        ProxyInit::Flag(true) => return Err(invalid_proxy(global, JSValue::TRUE)),
        ProxyInit::Flag(false) => return Ok(ProxyArg::Policy(ProxyOption::Direct)),
        // A URL instance has no `.url` own property; treat it as its href.
        ProxyInit::Url(url) => return explicit(url.to_js()),
        ProxyInit::String(href) => return string(href.to_js()),
        ProxyInit::Missing => return Ok(ProxyArg::Absent),
        ProxyInit::Other(proxy_arg) => return Ok(ProxyArg::Unusable(proxy_arg)),
        ProxyInit::Options(proxy_arg) => proxy_arg,
    };
    let Some(url_arg) = proxy_arg.url(global)? else {
        return Ok(ProxyArg::Unusable(proxy_arg.object().as_value()));
    };
    // `href_from_js` accepts a string or a `URL` and is the sole validator.
    let href = proxy_href(global, url_arg.to_js())?;
    let mut headers = None;
    match proxy_arg.headers(global)? {
        ProxyHeaders::Missing => {}
        ProxyHeaders::Headers((fetch_headers, _)) => {
            headers = Some(from_fetch_headers(global, Some(fetch_headers), None)?);
        }
        ProxyHeaders::Init(headers_value) => {
            if let Some(fetch_headers) = HeadersRef::create_from_js(global, headers_value.to_js())?
            {
                headers = Some(from_fetch_headers(global, Some(&fetch_headers), None)?);
            }
        }
    }
    let respect_no_proxy = proxy_arg.respect_no_proxy(global)?.unwrap_or(true);
    Ok(ProxyArg::Policy(ProxyOption::Explicit {
        href,
        headers,
        respect_no_proxy,
    }))
}

static NEXT_POOL_ID: AtomicU64 = AtomicU64::new(1);

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct FetchSession {
    pool: http::PoolOptions,
    keep_alive: bool,
    ssl_config: Option<http::ssl_config::SharedPtr>,
    reject_unauthorized: Option<bool>,
    proxy: Option<ProxyOption>,
    unix: Box<[u8]>,
    /// Whether a request ever named this session, so its pool can hold sockets.
    used: Cell<bool>,
    /// The wrapper. Strong while a `SessionHold` exists: a request parks its
    /// socket in this session's pool, and collecting the session closes the pool.
    this_value: JsCell<JsRef>,
    /// The wrapper and each `SessionHold` hold a ref.
    ref_count: Cell<u32>,
    /// Armed in the context whose script made the session: the connections its pool keeps
    /// alive are that context's, and close with it. (The session itself stays usable.)
    abort_handle: bun_jsc::AbortHandle,
}

bun_jsc::impl_abort_handle_owner!(FetchSession, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live (dropping it drops the handle).
    unsafe { &*this }.close()
});

/// One request's hold on its session, from the moment `fetch()` reads the
/// `session` option: the option is a property of `init`, so nothing else keeps
/// the wrapper alive while the rest of `init` is read. JS thread only.
pub(crate) struct SessionHold(RefPtr<FetchSession>);

impl SessionHold {
    pub(crate) fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<SessionHold> {
        let Some(session) = value.as_::<FetchSession>() else {
            return Err(global.throw_invalid_arguments(format_args!(
                "fetch: 'session' must be a Bun.FetchSession"
            )));
        };
        // SAFETY: `value` holds a ref on it.
        let session = unsafe { RefPtr::init_ref(session) };
        session.used.set(true);
        if session.is_only_hold() {
            session.this_value.with_mut(|r| r.upgrade(global));
        }
        Ok(SessionHold(session))
    }

    fn session(&self) -> &FetchSession {
        &self.0
    }

    pub(crate) fn pool(&self) -> http::PoolOptions {
        self.session().pool
    }
    pub(crate) fn keep_alive(&self) -> bool {
        self.session().keep_alive
    }
    pub(crate) fn ssl_config(&self) -> Option<http::ssl_config::SharedPtr> {
        self.session().ssl_config.clone()
    }
    pub(crate) fn reject_unauthorized(&self) -> Option<bool> {
        self.session().reject_unauthorized
    }
    pub(crate) fn proxy(&self) -> Option<&ProxyOption> {
        self.session().proxy.as_ref()
    }
    pub(crate) fn unix(&self) -> &[u8] {
        &self.session().unix
    }
    pub(crate) fn check_server_identity(&self) -> Option<JSValue> {
        js::check_server_identity_get_cached(self.session().this_value.try_get()?)
    }
}

impl Drop for SessionHold {
    fn drop(&mut self) {
        let session = self.session();
        if session.is_only_hold() {
            session.this_value.with_mut(JsRef::downgrade);
        }
    }
}

impl FetchSession {
    /// True when one `SessionHold` and the wrapper hold the refs, or two holds after VM teardown finalized the wrapper.
    fn is_only_hold(&self) -> bool {
        self.ref_count.get() == 2
    }

    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        init: Option<FetchSessionInit<'a>>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let mut this = Box::new(FetchSession {
            pool: http::PoolOptions {
                id: NEXT_POOL_ID.fetch_add(1, Ordering::Relaxed),
                idle_timeout_seconds: 0,
                max_idle_sockets: 0,
            },
            keep_alive: true,
            ssl_config: None,
            reject_unauthorized: None,
            proxy: None,
            unix: Box::default(),
            used: Cell::new(false),
            this_value: JsCell::new(JsRef::empty()),
            ref_count: Cell::new(1),
            abort_handle: bun_jsc::AbortHandle::for_owner::<FetchSession>(),
        });
        // SAFETY: a heap allocation at its final address; its `Drop` (with the last ref, or when
        // this constructor fails) disarms the handle.
        unsafe {
            bun_jsc::AbortHandle::arm_owner(&raw mut *this, cx.js_thread().context());
        }
        let check_server_identity = Self::parse_options(&mut this, cx.global(), init)?;

        // SAFETY: the allocation's one ref, which the wrapper adopts.
        let session = unsafe { RefPtr::from_raw(bun_core::heap::into_raw(this)) };
        let this = session.this_ptr();
        let this_value = structure.create(&cx.heap, session);
        this.this_value.set(JsRef::init_weak(this_value.to_js()));
        if let Some(callback) = check_server_identity {
            js::check_server_identity_set_cached(this_value.to_js(), cx.global(), callback);
        }
        Ok(this_value)
    }

    /// Returns `tls.checkServerIdentity`, which the JS wrapper holds.
    fn parse_options(
        this: &mut Self,
        global: &JSGlobalObject,
        options: Option<FetchSessionInit<'_>>,
    ) -> JsResult<Option<JSValue>> {
        let vm = global.bun_vm();
        let mut check_server_identity = None;
        let Some(options) = options else {
            return Ok(None);
        };

        if let Some(tls) = options.tls(global)? {
            let parsed = parse_tls(vm, global, tls)?;
            this.ssl_config = parsed.ssl_config;
            this.reject_unauthorized = parsed.reject_unauthorized;
            check_server_identity = parsed.check_server_identity;
        }

        match parse_proxy(global, options.proxy(global)?)? {
            ProxyArg::Policy(policy) => this.proxy = Some(policy),
            ProxyArg::Absent => {}
            ProxyArg::Unusable(proxy) => return Err(invalid_proxy(global, proxy.to_js())),
        }

        let unix = options.unix(global)?;
        if !matches!(unix, UnixPath::Missing) {
            if let Some(path) = super::parse_unix(vm, global, unix)? {
                this.unix = path;
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "FetchSession: 'unix' must be a non-empty string"
                )));
            }
        }
        if !this.unix.is_empty() && matches!(this.proxy, Some(ProxyOption::Explicit { .. })) {
            return Err(global.throw_invalid_arguments(format_args!(
                "FetchSession: cannot use a proxy with a unix socket"
            )));
        }

        match options.keep_alive(global)? {
            FetchKeepAlive::Missing => {}
            FetchKeepAlive::Flag(keep_alive) => this.keep_alive = keep_alive,
            FetchKeepAlive::Options(keep_alive) => {
                if let Some(seconds) =
                    positive_number(global, keep_alive.idle_timeout(global)?, "idleTimeout")?
                {
                    // The pool timer has the same wheel limits as the request idle timeout.
                    this.pool.idle_timeout_seconds =
                        http::normalize_idle_timeout_seconds(seconds.ceil() as u64);
                }
                if let Some(count) = keep_alive.max_idle_sockets(global)? {
                    if count == 0 {
                        return Err(global.throw_range_error(
                            f64::NAN,
                            jsc::RangeErrorOptions {
                                field_name: b"keepAlive.maxIdleSockets",
                                min: 1,
                                max: i64::from(u16::MAX),
                                ..Default::default()
                            },
                        ));
                    }
                    this.pool.max_idle_sockets = count;
                }
            }
        }

        Ok(check_server_identity)
    }

    /// `fetch` bound to this session, so it can be handed to anything that
    /// takes a `fetch` function.
    pub(crate) fn get_fetch(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let target = jsc::JSFunction::create(
            global,
            "fetch",
            crate::generated_bindgen::fetch::Bun__Fetch__sessionFetch,
            1,
            Default::default(),
        );
        target.bind(
            global,
            this_value.to_js(),
            &bun_core::String::static_("fetch"),
            1.0,
            &[],
        )
    }

    /// Close this session's idle keep-alive connections. Requests in flight
    /// finish, and the session stays usable.
    pub(crate) fn close(&self) {
        if self.used.get() && http::http_thread::is_initialized() {
            http::http_thread().schedule_pool_close(self.pool.id);
        }
    }

    pub(crate) fn finalize(&self) {
        self.this_value.with_mut(|r| r.finalize());
        self.close();
    }
}

/// `keepAlive[name]` as a finite number above zero; `undefined` is absent.
fn positive_number(
    global: &JSGlobalObject,
    value: IdleTimeout,
    name: &'static str,
) -> JsResult<Option<f64>> {
    let number = match value {
        IdleTimeout::Missing => return Ok(None),
        IdleTimeout::Number(number) => number,
        IdleTimeout::Other => f64::NAN,
    };
    if !(number.is_finite() && number > 0.0) {
        return Err(global.throw_invalid_arguments(format_args!(
            "FetchSession: 'keepAlive.{name}' must be a positive number"
        )));
    }
    Ok(Some(number))
}
