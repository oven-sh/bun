//! `Bun.FetchSession`: connection settings shared by the `fetch()` calls that
//! name it (`fetch(url, { session })`), and the keep-alive pool they share.

use core::cell::Cell;
use core::sync::atomic::{AtomicU64, Ordering};

use bun_core::Tag as BunStringTag;
use bun_http::{self as http, Headers};
use bun_http_jsc::headers_jsc::from_fetch_headers;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsCell, JsCellRefExt as _, JsClass as _,
    JsRef, JsResult, URLJsc as _,
};

use crate::socket::ssl_config::{SSLConfig, SSLConfigFromJs as _};
use crate::webcore::FetchHeaders;
use crate::webcore::response::HeadersRef;

pub use crate::generated_classes::js_FetchSession as js;

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
    tls: JSValue,
) -> JsResult<TlsOption> {
    let mut parsed = TlsOption {
        ssl_config: None,
        reject_unauthorized: None,
        check_server_identity: None,
    };
    if let Some(reject) = tls.get(global, "rejectUnauthorized")? {
        if reject.is_boolean() {
            parsed.reject_unauthorized = Some(reject.as_boolean());
        } else if reject.is_number() {
            parsed.reject_unauthorized = Some(reject.to_int32() != 0);
        }
    }
    if let Some(callback) = tls.get(global, "checkServerIdentity")? {
        if callback.is_cell() && callback.is_callable() {
            parsed.check_server_identity = Some(callback);
        }
    }
    if let Some(config) = SSLConfig::from_js(vm, global, tls)? {
        parsed.ssl_config = Some(http::ssl_config::global_registry::intern(config));
    }
    Ok(parsed)
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

/// `None`: the value does not select a proxy policy (`undefined`, `null`,
/// `""`, an object without `url`), so the caller's default applies.
pub(crate) fn parse_proxy(
    global: &JSGlobalObject,
    proxy_arg: JSValue,
) -> JsResult<Option<ProxyOption>> {
    if proxy_arg.is_boolean() {
        return Ok((!proxy_arg.as_boolean()).then_some(ProxyOption::Direct));
    }
    // A URL instance has no `.url` own property; treat it as its href.
    let is_url_instance = bun_jsc::DOMURL::cast_(proxy_arg, global.vm()).is_some();
    if is_url_instance || (proxy_arg.is_string() && proxy_arg.get_length(global)? > 0) {
        return Ok(Some(ProxyOption::Explicit {
            href: proxy_href(global, proxy_arg)?,
            headers: None,
            respect_no_proxy: true,
        }));
    }
    if !proxy_arg.is_object() {
        return Ok(None);
    }
    let Some(url_arg) = proxy_arg.get(global, "url")? else {
        return Ok(None);
    };
    if url_arg.is_undefined_or_null() {
        return Ok(None);
    }
    // `href_from_js` accepts a string or a `URL` and is the sole validator.
    let href = proxy_href(global, url_arg)?;
    let mut headers = None;
    if let Some(headers_value) = proxy_arg.get(global, "headers")? {
        if !headers_value.is_undefined_or_null() {
            if let Some(fetch_headers) = FetchHeaders::cast(headers_value) {
                let fetch_headers = bun_ptr::BackRef::from(fetch_headers);
                headers = Some(from_fetch_headers(Some(&*fetch_headers), None));
            } else if let Some(fetch_headers) = HeadersRef::create_from_js(global, headers_value)? {
                headers = Some(from_fetch_headers(Some(&fetch_headers), None));
            }
        }
    }
    let respect_no_proxy = proxy_arg
        .get_boolean_strict(global, "respectNoProxy")?
        .unwrap_or(true);
    Ok(Some(ProxyOption::Explicit {
        href,
        headers,
        respect_no_proxy,
    }))
}

static NEXT_POOL_ID: AtomicU64 = AtomicU64::new(1);

#[bun_jsc::JsClass]
pub struct FetchSession {
    pool: http::PoolOptions,
    keep_alive: bool,
    ssl_config: Option<http::ssl_config::SharedPtr>,
    reject_unauthorized: Option<bool>,
    proxy: Option<ProxyOption>,
    unix: Box<[u8]>,
    /// Whether a request ever named this session, so its pool can hold sockets.
    used: Cell<bool>,
    /// The wrapper. Strong while `in_flight` is not zero: a request parks its
    /// socket in this session's pool, and collecting the session closes the pool.
    this_value: JsCell<JsRef>,
    /// Requests that hold a `SessionHold`.
    in_flight: Cell<u32>,
}

/// The `session` option of one `fetch()` call. The wrapper is an argument of
/// that call, which keeps the session and its callbacks alive.
#[derive(Clone, Copy)]
pub(crate) struct SessionRef<'a> {
    session: &'a FetchSession,
    wrapper: JSValue,
}

impl<'a> SessionRef<'a> {
    pub(crate) fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<SessionRef<'a>> {
        let Some(session) = FetchSession::from_js(value) else {
            return Err(global.throw_invalid_arguments(format_args!(
                "fetch: 'session' must be a Bun.FetchSession"
            )));
        };
        // SAFETY: `from_js` returned the live `m_ctx` of the wrapper `value` roots.
        let session = unsafe { &*session };
        session.used.set(true);
        Ok(SessionRef {
            session,
            wrapper: value,
        })
    }

    /// Keep the session alive for a request that is about to go out.
    pub(crate) fn hold(self, global: &JSGlobalObject) -> SessionHold {
        let session = self.session;
        let held = session.in_flight.get();
        session.in_flight.set(held + 1);
        if held == 0 {
            session.this_value.with_mut(|this| this.upgrade(global));
        }
        SessionHold(core::ptr::NonNull::from(session))
    }
    pub(crate) fn pool(self) -> http::PoolOptions {
        self.session.pool
    }
    pub(crate) fn keep_alive(self) -> bool {
        self.session.keep_alive
    }
    pub(crate) fn ssl_config(self) -> Option<http::ssl_config::SharedPtr> {
        self.session.ssl_config.clone()
    }
    pub(crate) fn reject_unauthorized(self) -> Option<bool> {
        self.session.reject_unauthorized
    }
    pub(crate) fn check_server_identity(self) -> Option<JSValue> {
        js::check_server_identity_get_cached(self.wrapper)
    }
    pub(crate) fn proxy(self) -> Option<&'a ProxyOption> {
        self.session.proxy.as_ref()
    }
    pub(crate) fn unix(self) -> &'a [u8] {
        &self.session.unix
    }
    pub(crate) fn on_stats(self) -> Option<JSValue> {
        js::on_stats_get_cached(self.wrapper)
    }
}

/// One in-flight request's hold on its session. JS thread only.
pub(crate) struct SessionHold(core::ptr::NonNull<FetchSession>);

impl SessionHold {
    fn session(&self) -> &FetchSession {
        // SAFETY: this hold is part of `in_flight`, and the box is not freed
        // while that is not zero: the wrapper is strongly held, and a
        // `finalize` that runs anyway (VM teardown) leaves the box to the
        // last hold.
        unsafe { self.0.as_ref() }
    }

    pub(crate) fn check_server_identity(&self) -> Option<JSValue> {
        js::check_server_identity_get_cached(self.session().this_value.try_get()?)
    }

    pub(crate) fn on_stats(&self) -> Option<JSValue> {
        js::on_stats_get_cached(self.session().this_value.try_get()?)
    }
}

impl Drop for SessionHold {
    fn drop(&mut self) {
        let session = self.session();
        let left = session.in_flight.get() - 1;
        session.in_flight.set(left);
        if left != 0 {
            return;
        }
        if session.this_value.get().is_finalized() {
            // SAFETY: `finalize` ran under this hold and left the box to it.
            drop(unsafe { bun_core::heap::take(self.0.as_ptr()) });
        } else {
            session.this_value.with_mut(|this| this.downgrade());
        }
    }
}

impl FetchSession {
    pub fn constructor(
        global: &JSGlobalObject,
        frame: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<Box<FetchSession>> {
        let vm = global.bun_vm();
        let options = frame.argument(0);
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
            this_value: JsCell::new(JsRef::init_weak(this_value)),
            in_flight: Cell::new(0),
        });
        if options.is_undefined_or_null() {
            return Ok(this);
        }
        if !options.is_object() {
            return Err(global
                .throw_invalid_arguments(format_args!("FetchSession: options must be an object")));
        }

        if let Some(tls) = options.get(global, "tls")? {
            if tls.is_object() {
                let parsed = parse_tls(vm, global, tls)?;
                this.ssl_config = parsed.ssl_config;
                this.reject_unauthorized = parsed.reject_unauthorized;
                if let Some(callback) = parsed.check_server_identity {
                    js::check_server_identity_set_cached(this_value, global, callback);
                }
            } else if !tls.is_undefined_or_null() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "FetchSession: 'tls' must be an object"
                )));
            }
        }

        if let Some(proxy) = options.get(global, "proxy")? {
            this.proxy = parse_proxy(global, proxy)?;
        }

        if let Some(unix) = options.get(global, "unix")? {
            if let Some(path) = super::parse_unix(vm, global, unix)? {
                this.unix = path;
            } else if !unix.is_undefined_or_null() {
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

        if let Some(keep_alive) = options.get(global, "keepAlive")? {
            if keep_alive.is_boolean() {
                this.keep_alive = keep_alive.as_boolean();
            } else if keep_alive.is_object() {
                if let Some(seconds) = positive_number(global, keep_alive, "idleTimeout")? {
                    // The pool timer has the same wheel limits as the request idle timeout.
                    this.pool.idle_timeout_seconds =
                        http::normalize_idle_timeout_seconds(seconds.ceil() as u64);
                }
                if let Some(count) = keep_alive.get(global, "maxIdleSockets")? {
                    this.pool.max_idle_sockets = global.validate_integer_range::<u16>(
                        count,
                        this.pool.max_idle_sockets,
                        bun_jsc::IntegerRange {
                            min: 1,
                            max: i128::from(u16::MAX),
                            field_name: b"keepAlive.maxIdleSockets",
                            always_allow_zero: false,
                        },
                    )?;
                }
            } else if !keep_alive.is_undefined_or_null() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "FetchSession: 'keepAlive' must be a boolean or an object"
                )));
            }
        }

        if let Some(on_stats) = options.get_function(global, "onStats")? {
            js::on_stats_set_cached(this_value, global, on_stats);
        }
        Ok(this)
    }

    /// `fetch` bound to this session, so it can be handed to anything that
    /// takes a `fetch` function.
    pub(crate) fn get_fetch(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let target = jsc::JSFunction::create(
            global,
            "fetch",
            super::__jsc_host_session_fetch,
            1,
            Default::default(),
        );
        target.bind(
            global,
            this_value,
            &bun_core::String::static_("fetch"),
            1.0,
            &[],
        )
    }

    /// Close this session's idle keep-alive connections. Requests in flight
    /// finish, and the session stays usable.
    #[bun_jsc::host_fn(method)]
    pub fn close(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        self.close_idle_sockets();
        Ok(JSValue::UNDEFINED)
    }

    fn close_idle_sockets(&self) {
        if self.used.get() && http::http_thread::is_initialized() {
            http::http_thread().schedule_pool_close(self.pool.id);
        }
    }

    #[allow(
        clippy::boxed_local,
        reason = "reclaim point for the generated finalizer"
    )]
    pub fn finalize(self: Box<Self>) {
        self.this_value.with_mut(|this| this.finalize());
        self.close_idle_sockets();
        // Only when the VM is torn down under requests in flight: their holds
        // still point here, and the last one frees the box.
        if self.in_flight.get() != 0 {
            let _ = bun_core::heap::into_raw(self);
        }
    }
}

/// `keepAlive[name]` as a finite number above zero; `undefined` is absent.
fn positive_number(
    global: &JSGlobalObject,
    keep_alive: JSValue,
    name: &'static str,
) -> JsResult<Option<f64>> {
    let Some(value) = keep_alive.get(global, name)? else {
        return Ok(None);
    };
    if value.is_undefined() {
        return Ok(None);
    }
    let number = if value.is_number() {
        value.as_number()
    } else {
        f64::NAN
    };
    if !(number.is_finite() && number > 0.0) {
        return Err(global.throw_invalid_arguments(format_args!(
            "FetchSession: 'keepAlive.{name}' must be a positive number"
        )));
    }
    Ok(Some(number))
}
