// ──────────────────────────────────────────────────────────────────────────
// Error message constants
// ──────────────────────────────────────────────────────────────────────────

pub const FETCH_ERROR_NO_ARGS: &str = "fetch() expects a string but received no arguments.";
pub const FETCH_ERROR_BLANK_URL: &str = "fetch() URL must not be a blank string.";
pub const FETCH_ERROR_UNEXPECTED_BODY: &str =
    "fetch() request with GET/HEAD/OPTIONS method cannot have body.";
pub const FETCH_ERROR_PROXY_UNIX: &str = "fetch() cannot use a proxy with a unix socket.";

// TODO(port): Zig used `std.EnumMap(jsc.c.JSType, []const u8)` for the
// type-name → message tables. `bun_jsc::c` (the deprecated JSC C-API module)
// does not expose `JSType` (it's an opaque-value enum), and `EnumMap` requires
// `#[derive(enum_map::Enum)]` on the key. Surface as plain `[&str; 8]` indexed
// by the C `kJSType*` ordinal until a typed key is available.
pub const FETCH_TYPE_ERROR_NAMES: [&str; 8] = [
    /* kJSTypeUndefined */ "Undefined",
    /* kJSTypeNull      */ "Null",
    /* kJSTypeBoolean   */ "Boolean",
    /* kJSTypeNumber    */ "Number",
    /* kJSTypeString    */ "String",
    /* kJSTypeObject    */ "Object",
    /* kJSTypeSymbol    */ "Symbol",
    /* kJSTypeBigInt    */ "BigInt",
];

pub const FETCH_TYPE_ERROR_STRING_VALUES: [&str; 8] = [
    concat!("fetch() expects a string, but received ", "Undefined"),
    concat!("fetch() expects a string, but received ", "Null"),
    concat!("fetch() expects a string, but received ", "Boolean"),
    concat!("fetch() expects a string, but received ", "Number"),
    concat!("fetch() expects a string, but received ", "String"),
    concat!("fetch() expects a string, but received ", "Object"),
    concat!("fetch() expects a string, but received ", "Symbol"),
    concat!("fetch() expects a string, but received ", "BigInt"),
];

pub const FETCH_TYPE_ERROR_STRINGS: [&str; 8] = FETCH_TYPE_ERROR_STRING_VALUES;

// ──────────────────────────────────────────────────────────────────────────
// Re-export: FetchTasklet lives in ./fetch/FetchTasklet.zig
// ──────────────────────────────────────────────────────────────────────────

// TODO(b2-blocked): module wiring — fetch.rs + fetch/ subdir (Rust 2018 path).
// `fetch/FetchTasklet.rs` is itself a heavy gated draft.

#[path = "fetch/FetchTasklet.rs"]
pub mod fetch_tasklet;

// ──────────────────────────────────────────────────────────────────────────
// fetch() implementation
// ──────────────────────────────────────────────────────────────────────────

use core::ptr::NonNull;
use std::io::Write as _;

use bun_core::Output;
use crate::webcore::jsc::{self as jsc, CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, VirtualMachine};
use bun_jsc::{StringJsc as _, SysErrorJsc as _, HTTPHeaderName};
use bun_sys::FdExt as _;
use bun_str::{strings, String as BunString, ZigString, ZigStringSlice, Tag as BunStringTag};
use bun_paths::{self, PathBuffer};
use bun_http::{self as http, FetchRedirect, Headers, MimeType};
use bun_http::headers::Options as HeadersOptions;
use bun_http_types::Method::Method;
use bun_http_jsc::method_jsc;
// `FromJsEnum for FetchRedirect` lives in bun_http_jsc; importing the impl crate
// brings the trait impl into scope for `JSValue::get_optional_enum::<FetchRedirect>`.
use bun_http_jsc as _;
use bun_url::URL as ZigURL;
use bun_url::PercentEncoding;
use bun_resolver::data_url::DataURL;
use crate::socket::ssl_config::SSLConfig;
use crate::webcore::{AbortSignal, Blob, Body, FetchHeaders, ObjectURLRegistry, ReadableStream, Request, Response};
use crate::webcore::{body, response, readable_stream, blob};
use crate::webcore::body::{Value as BodyValue, Action as BodyValueLockedAction, InternalBlob};
use crate::webcore::headers_ref::{any_blob_ref_opt, fetch_headers_ref};
use crate::node;
use crate::node::types::{Encoding, PathOrFileDescriptor};
#[cfg(windows)]
use bun_paths::resolve_path::PosixToWinNormalizer;
use bun_picohttp as picohttp;
use crate::webcore::s3::client as s3;
use bun_s3_signing::{SignOptions, SignResult};

pub use self::fetch_tasklet::FetchTasklet;
use self::fetch_tasklet::{HTTPRequestBody, FetchOptions};

// ──────────────────────────────────────────────────────────────────────────
// Local extension shims (upstream methods not yet ported / not in scope)
// ──────────────────────────────────────────────────────────────────────────

/// `JSGlobalObject::toTypeError` — produce (not throw) a TypeError JSValue
/// with an `ErrorCode`. Upstream lives in a sibling-module trait
/// (`h2_frame_parser_body::H2GlobalErrExt`); duplicated locally to avoid the
/// cross-module reach-through.
trait FetchGlobalErrExt {
    fn to_type_error(&self, code: jsc::ErrorCode, msg: &'static str) -> JSValue;
    fn to_type_error_fmt(&self, code: jsc::ErrorCode, args: core::fmt::Arguments<'_>) -> JSValue;
    fn throw_not_enough_arguments(&self, name: &'static str, expected: usize, got: usize) -> jsc::JsError;
}
impl FetchGlobalErrExt for JSGlobalObject {
    fn to_type_error(&self, code: jsc::ErrorCode, msg: &'static str) -> JSValue {
        code.fmt(self, format_args!("{msg}"))
    }
    fn to_type_error_fmt(&self, code: jsc::ErrorCode, args: core::fmt::Arguments<'_>) -> JSValue {
        code.fmt(self, args)
    }
    fn throw_not_enough_arguments(&self, name: &'static str, expected: usize, got: usize) -> jsc::JsError {
        self.throw_invalid_arguments(format_args!(
            "{name} requires at least {expected} argument{}, but only {got} were passed",
            if expected == 1 { "" } else { "s" }
        ))
    }
}

/// `bun.String.hasPrefixComptime` — upstream `bun_str::String` only exposes
/// `eql_comptime`; prefix matching is in `bun_str::strings::has_prefix_comptime`
/// (free fn over `&[u8]`). Bridge via the encoding-aware byte view.
trait FetchBunStringExt {
    fn has_prefix_comptime(&self, prefix: &'static [u8]) -> bool;
}
impl FetchBunStringExt for BunString {
    #[inline]
    fn has_prefix_comptime(&self, prefix: &'static [u8]) -> bool {
        if self.is_utf16() {
            strings::has_prefix_comptime_utf16(self.utf16(), prefix)
        } else {
            strings::has_prefix_comptime(self.latin1(), prefix)
        }
    }
}

/// Convert the runtime-tier `socket::ssl_config::SSLConfig` into the
/// `bun_http::ssl_config::SharedPtr` shape FetchTasklet/AsyncHTTP expect.
/// `bun_http` (T5) cannot name the runtime SSLConfig (cycle), so we deep-copy
/// into the lower-tier struct and intern it in the http-tier registry.
#[inline]
fn ssl_config_intern_for_http(config: SSLConfig) -> http::ssl_config::SharedPtr {
    http::ssl_config::global_registry::intern(config.into_http())
}

/// Build the refcounted `bun_s3_signing::S3Credentials` from the lower-tier
/// `bun_dotenv::S3Credentials` POD mirror. The dotenv crate (T2) cannot name
/// `bun_s3_signing` types (would be an upward dep), so the conversion lives at
/// the call site here in T6.
fn s3_credentials_from_env(env: &bun_dotenv::S3Credentials) -> bun_s3_signing::S3Credentials {
    bun_s3_signing::S3Credentials::new_value(
        env.access_key_id.clone(),
        env.secret_access_key.clone(),
        env.region.clone(),
        env.endpoint.clone(),
        env.bucket.clone(),
        env.session_token.clone(),
        env.insecure_http,
    )
}

/// `Blob.Any` accessor shim — Zig union-field access `body.AnyBlob.Blob`.
trait AnyBlobExt {
    fn blob(&self) -> &Blob;
}
impl AnyBlobExt for blob::Any {
    fn blob(&self) -> &Blob {
        match self {
            blob::Any::Blob(b) => b,
            _ => unreachable!("Blob.Any::blob() on non-Blob variant"),
        }
    }
}

/// `HTTPRequestBody` accessor shims missing from FetchTasklet.rs.
trait HTTPRequestBodyExt {
    fn any_blob(&self) -> &blob::Any;
    fn sendfile_mut(&mut self) -> &mut http::SendFile;
}
impl HTTPRequestBodyExt for HTTPRequestBody {
    fn any_blob(&self) -> &blob::Any {
        match self {
            HTTPRequestBody::AnyBlob(b) => b,
            _ => unreachable!("HTTPRequestBody::any_blob() on non-AnyBlob"),
        }
    }
    fn sendfile_mut(&mut self) -> &mut http::SendFile {
        match self {
            HTTPRequestBody::Sendfile(sf) => sf,
            _ => unreachable!("HTTPRequestBody::sendfile_mut() on non-Sendfile"),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// dataURLResponse
// ──────────────────────────────────────────────────────────────────────────

fn data_url_response(data_url_: DataURL, global_this: &JSGlobalObject) -> JSValue {
    let mut data_url = data_url_;

    let data = match data_url.decode_data() {
        Ok(d) => d,
        Err(_) => {
            let err = global_this.create_error_instance("failed to fetch the data URL");
            return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            );
        }
    };
    let mut blob = Blob::init(data, global_this);

    let mut allocated = false;
    let mime_type = MimeType::MimeType::init(data_url.mime_type, true, Some(&mut allocated));
    // PORT NOTE: `mime_type.value` is `Cow<'static, [u8]>`; Blob.content_type is `*const [u8]`.
    blob.content_type = match mime_type.value {
        std::borrow::Cow::Borrowed(s) => s as *const [u8],
        std::borrow::Cow::Owned(v) => Box::leak(v.into_boxed_slice()) as *const [u8],
    };
    if allocated {
        blob.content_type_allocated = true;
    }

    let mut response = Box::new(Response::init(
        response::Init {
            status_code: 200,
            status_text: BunString::create_atom(b"OK"),
            ..Default::default()
        },
        Body {
            value: BodyValue::Blob(blob),
        },
        data_url.url.dupe_ref(),
        false,
    ));

    JSPromise::resolved_promise_value(global_this, response.to_js(global_this))
}

// ──────────────────────────────────────────────────────────────────────────
// Bun__fetchPreconnect
// ──────────────────────────────────────────────────────────────────────────

#[bun_jsc::host_fn]
#[unsafe(export_name = "Bun__fetchPreconnect")]
pub fn bun_fetch_preconnect(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();
    let arguments = arguments.slice();

    if arguments.len() < 1 {
        return Err(global_object.throw_not_enough_arguments("fetch.preconnect", 1, arguments.len()));
    }

    let url_str = jsc::URL::href_from_js(arguments[0], global_object)?;
    // PORT NOTE: `defer url_str.deref()` → BunString impls Drop.

    if global_object.has_exception() {
        return Ok(JSValue::ZERO);
    }

    if url_str.tag() == BunStringTag::Dead {
        return Err(global_object
            .err(jsc::ErrorCode::INVALID_ARG_TYPE, format_args!("Invalid URL"))
            .throw());
    }

    if url_str.is_empty() {
        return Err(global_object
            .err(jsc::ErrorCode::INVALID_ARG_TYPE, format_args!("{}", FETCH_ERROR_BLANK_URL))
            .throw());
    }

    // PORT NOTE: bun.handleOom(url_str.toOwnedSlice(...)) → to_owned_slice() aborts on OOM.
    // `preconnect` takes a `URL<'static>` that borrows a `Box<[u8]>` href and
    // assumes ownership when `is_url_owned == true` (it reconstructs the Box
    // to free it). Hand the allocation off via `Box::into_raw`.
    let href_box: Box<[u8]> = url_str.to_owned_slice().into_boxed_slice();
    let href_raw: *mut [u8] = Box::into_raw(href_box);
    // SAFETY: `href_raw` is a freshly-leaked Box<[u8]>; we either pass ownership
    // to `preconnect` (which frees it) or reclaim it on the early-return paths.
    let href: &'static [u8] = unsafe { &*href_raw };
    let url = ZigURL::parse(href);

    macro_rules! reclaim_href {
        () => {
            // SAFETY: paired with the `Box::into_raw` above; not yet handed to preconnect.
            drop(unsafe { Box::from_raw(href_raw) });
        };
    }

    if !url.is_http() && !url.is_https() && !url.is_s3() {
        reclaim_href!();
        return Err(global_object.throw_invalid_arguments(format_args!("URL must be HTTP or HTTPS")));
    }

    if url.hostname.is_empty() {
        reclaim_href!();
        return Err(global_object
            .err(jsc::ErrorCode::INVALID_ARG_TYPE, format_args!("{}", FETCH_ERROR_BLANK_URL))
            .throw());
    }

    if !url.has_valid_port() {
        reclaim_href!();
        return Err(global_object.throw_invalid_arguments(format_args!("Invalid port")));
    }

    // PORT NOTE: `preconnect` is a free fn in `bun_http::async_http`. Ownership
    // of `href_raw` transfers here (`is_url_owned: true`).
    http::async_http::preconnect(url, true);
    Ok(JSValue::UNDEFINED)
}

// ──────────────────────────────────────────────────────────────────────────
// StringOrURL helper
// ──────────────────────────────────────────────────────────────────────────

struct StringOrURL;

impl StringOrURL {
    pub fn from_js(value: JSValue, global_this: &JSGlobalObject) -> JsResult<Option<BunString>> {
        if value.is_string() {
            return Ok(Some(BunString::from_js(value, global_this)?));
        }

        let out = jsc::URL::href_from_js(value, global_this)?;
        if out.tag() == BunStringTag::Dead {
            return Ok(None);
        }
        Ok(Some(out))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Bun__fetch / nodeHttpClient entry points
// ──────────────────────────────────────────────────────────────────────────

/// Public entry point for `Bun.fetch` - validates body on GET/HEAD/OPTIONS
#[bun_jsc::host_fn]
#[unsafe(export_name = "Bun__fetch")]
pub fn bun_fetch(ctx: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    fetch_impl::<false>(ctx, callframe)
}

/// Internal entry point for Node.js HTTP client - allows body on GET/HEAD/OPTIONS
#[bun_jsc::host_fn]
pub fn node_http_client(ctx: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    fetch_impl::<true>(ctx, callframe)
}

// ──────────────────────────────────────────────────────────────────────────
// URLType (local enum inside fetchImpl in Zig)
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
enum URLType {
    Remote,
    File,
    Blob,
}

// ──────────────────────────────────────────────────────────────────────────
// fetchImpl — shared implementation
// ──────────────────────────────────────────────────────────────────────────

/// Shared implementation of fetch
fn fetch_impl<const ALLOW_GET_BODY: bool>(
    ctx: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding();
    let global_this = ctx;
    let arguments = callframe.arguments_old::<2>();
    bun_core::analytics::Features::FETCH.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
    // SAFETY: `VirtualMachine::get()` returns the live thread-local VM pointer; it
    // outlives this call frame.
    let vm = unsafe { &mut *VirtualMachine::get() };

    // used to clean up dynamically allocated memory on error (a poor man's errdefer)
    // PORT NOTE: in Rust, owned locals (Box/Vec/BunString/etc.) Drop on early return,
    // so most of the Zig `defer { ... }` block below is implicit. `is_error` is
    // retained to mirror control flow but no longer gates cleanup.
    #[allow(unused_assignments)]
    let mut is_error = false;
    let mut upgraded_connection = false;
    let mut force_http2 = false;
    let mut force_http3 = false;
    let mut force_http1 = false;

    if arguments.len == 0 {
        let err = ctx.to_type_error(jsc::ErrorCode::MISSING_ARGS, FETCH_ERROR_NO_ARGS);
        return Ok(
            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            ),
        );
    }

    let mut headers: Option<Headers> = None;
    let mut method = Method::GET;

    // PORT NOTE: hoist the one `&mut vm` accessor before `args` takes an
    // immutable borrow of `vm` for the rest of the function.
    let vm_verbose_fetch = vm.get_verbose_fetch();

    let mut args = jsc::ArgumentsSlice::init(vm, arguments.slice());

    let mut url = ZigURL::default();
    let first_arg = args.next_eat().unwrap();

    // We must always get the Body before the Headers That way, we can set
    // the Content-Type header from the Blob if no Content-Type header is
    // set in the Headers
    //
    // which is important for FormData.
    // https://github.com/oven-sh/bun/issues/2264
    //
    let mut body: HTTPRequestBody = HTTPRequestBody::default();

    let mut disable_timeout = false;
    let mut disable_keepalive = false;
    let mut disable_decompression = false;
    // SAFETY: `vm.log` is set during VM init and live for the VM lifetime.
    let mut verbose: http::HTTPVerboseLevel = if vm
        .log
        .map(|p| unsafe { p.as_ref() }.level.at_least(bun_logger::Level::Debug))
        .unwrap_or(false)
    {
        http::HTTPVerboseLevel::Headers
    } else {
        http::HTTPVerboseLevel::None
    };
    if verbose == http::HTTPVerboseLevel::None {
        verbose = vm_verbose_fetch;
    }

    let mut proxy: Option<ZigURL> = None;
    let mut redirect_type: FetchRedirect = FetchRedirect::Follow;
    // TODO(port): lifetime — AbortSignal is intrusive-refcounted; ref()/unref() are
    // manual. Model as Option<NonNull<AbortSignal>> with a Drop guard in Phase B.
    let mut signal: Option<NonNull<AbortSignal>> = None;
    // Custom Hostname
    let mut hostname: Option<bun_core::ZBox> = None;
    let mut range: Option<bun_core::ZBox> = None;
    let mut unix_socket_path: ZigStringSlice = ZigStringSlice::empty();

    // TODO(port): lifetime — `url` and `proxy` borrow into this buffer. Kept as
    // Vec<u8> (owned) here; ZigURL fields are raw slices in Phase A.
    let mut url_proxy_buffer: Vec<u8> = Vec::new();
    // PORT NOTE: Zig freely reassigns `url_proxy_buffer` while `url`/`proxy`
    // still point into it (or into the buffer about to replace it). Detach the
    // borrow-checker by parsing through a raw-pointer slice; the caller is
    // responsible for keeping the backing allocation alive (it always becomes
    // the new `url_proxy_buffer` before the old one is dropped).
    macro_rules! parse_url_detached {
        ($slice:expr) => {{
            let s: &[u8] = $slice;
            let (ptr, len) = (s.as_ptr(), s.len());
            // SAFETY: `s` points into a Vec that is immediately adopted as
            // `url_proxy_buffer` (or already is it); see PORT NOTE above.
            ZigURL::parse(unsafe { core::slice::from_raw_parts(ptr, len) })
        }};
    }
    let mut url_type = URLType::Remote;

    let mut ssl_config: Option<http::ssl_config::SharedPtr> = None;
    let mut reject_unauthorized = vm.get_tls_reject_unauthorized();
    let mut check_server_identity: JSValue = JSValue::ZERO;

    // PORT NOTE: the Zig `defer { ... }` block here freed signal/unix_socket_path/
    // url_proxy_buffer/headers/body/hostname/range/ssl_config on every exit path.
    // In Rust, all of these are owning types whose Drop runs on early return.
    // The explicit `signal.unref()` is the only side-effect not covered by Drop:
    // TODO(port): errdefer — Zig had `defer if (signal) |sig| sig.unref();` capturing
    // `signal` by ref across many mutations. Borrowck forbids guard-by-ref here; the
    // matched unref() is now done explicitly on the early-return paths via the Drop
    // of FetchTasklet (which adopts the ref) or, on error, leaked until Phase B.
    let _ = &signal;

    let options_object: Option<JSValue> = 'brk: {
        if let Some(options) = args.next_eat() {
            let options: JSValue = options;
            if options.is_object() || options.js_type() == jsc::JSType::DOMWrapper {
                break 'brk Some(options);
            }
        }
        break 'brk None;
    };

    // PORT NOTE: kept as raw `*mut Request` because the body re-borrows it
    // multiple times across long-lived option/init reads (Zig had no borrowck).
    let request: Option<*mut Request> = 'brk: {
        if first_arg.is_cell() {
            if let Some(request_) = first_arg.as_direct::<Request>() {
                break 'brk Some(request_);
            }
        }
        break 'brk None;
    };
    // Helper macro: short-lived `&mut Request` reborrow of the optional pointer.
    macro_rules! request_mut {
        () => {
            // SAFETY: `request` was obtained from a live JS-owned Request via
            // `as_direct`; each reborrow is non-overlapping at the call site.
            request.map(|p| unsafe { &mut *p })
        };
    }

    // If it's NOT a Request or a subclass of Request, treat the first argument as a URL.
    let url_str_optional = if first_arg.as_::<Request>().is_none() {
        StringOrURL::from_js(first_arg, global_this)?
    } else {
        None
    };
    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    let request_init_object: Option<JSValue> = 'brk: {
        if request.is_some() {
            break 'brk None;
        }
        if url_str_optional.is_some() {
            break 'brk None;
        }
        if first_arg.is_object() {
            break 'brk Some(first_arg);
        }
        break 'brk None;
    };

    let url_str: BunString = 'extract_url: {
        if let Some(str) = url_str_optional {
            break 'extract_url str;
        }

        if let Some(req) = request_mut!() {
            req.ensure_url(); // bun.handleOom — aborts on OOM
            break 'extract_url req.url.dupe_ref();
        }

        if let Some(request_init) = request_init_object {
            if let Some(url_) = request_init.fast_get(global_this, jsc::BuiltinName::Url)? {
                if !url_.is_undefined() {
                    break 'extract_url BunString::from_js(url_, global_this)?;
                }
            }
        }

        break 'extract_url BunString::empty();
    };
    // PORT NOTE: `defer url_str.deref()` → BunString impls Drop.

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    if url_str.is_empty() {
        is_error = true;
        let err = ctx.to_type_error(jsc::ErrorCode::INVALID_URL, FETCH_ERROR_BLANK_URL);
        return Ok(
            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            ),
        );
    }

    if url_str.has_prefix_comptime(b"data:") {
        let url_slice = url_str.to_utf8_without_ref();
        // PORT NOTE: `defer url_slice.deinit()` → Drop.

        let data_url = match DataURL::parse_without_check(url_slice.slice()) {
            Ok(d) => d,
            Err(_) => {
                let err = ctx.create_error_instance("failed to fetch the data URL");
                is_error = true;
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        err,
                    ),
                );
            }
        };
        let mut data_url = data_url;
        data_url.url = url_str.clone();
        return Ok(data_url_response(data_url, global_this));
    }

    // PORT NOTE: `ZigURL::from_string` returns `OwnedURL` (owns href buffer); we
    // immediately move that buffer into `url_proxy_buffer` and re-parse `url` to
    // borrow it, mirroring Zig's `url.href` ownership transfer.
    let owned_url = match ZigURL::from_string(&url_str) {
        Ok(u) => u,
        Err(_) => {
            let err = ctx.to_type_error(jsc::ErrorCode::INVALID_URL, "fetch() URL is invalid");
            is_error = true;
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    err,
                ),
            );
        }
    };
    url_proxy_buffer = owned_url.into_href().into_vec();
    url = parse_url_detached!(&url_proxy_buffer[..]);
    if url.is_file() {
        url_type = URLType::File;
    } else if url.is_blob() {
        url_type = URLType::Blob;
    }

    // **Start with the harmless ones.**

    // "method"
    method = 'extract_method: {
        if let Some(options) = options_object {
            if let Some(method_) = options.get_truthy(global_this, "method")? {
                break 'extract_method method_jsc::from_js(global_this, method_)?;
            }
        }

        if let Some(req) = request_mut!() {
            break 'extract_method Some(req.method);
        }

        if let Some(req) = request_init_object {
            if let Some(method_) = req.get_truthy(global_this, "method")? {
                break 'extract_method method_jsc::from_js(global_this, method_)?;
            }
        }

        break 'extract_method None;
    }
    .unwrap_or(Method::GET);

    // "decompress: boolean"
    disable_decompression = 'extract_disable_decompression: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

        // PERF(port): was `inline for` — plain loop, profile in Phase B
        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(decompression_value) = obj.get(global_this, "decompress")? {
                    if decompression_value.is_boolean() {
                        break 'extract_disable_decompression !decompression_value.as_boolean();
                    } else if decompression_value.is_number() {
                        break 'extract_disable_decompression decompression_value.to_int32() == 0;
                    }
                }

                if global_this.has_exception() {
                    is_error = true;
                    return Ok(JSValue::ZERO);
                }
            }
        }

        break 'extract_disable_decompression disable_decompression;
    };

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // "tls: TLSConfig"
    ssl_config = 'extract_ssl_config: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

        // PERF(port): was `inline for` — plain loop, profile in Phase B
        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(tls) = obj.get(global_this, "tls")? {
                    if tls.is_object() {
                        if let Some(reject) = tls.get(ctx, "rejectUnauthorized")? {
                            if reject.is_boolean() {
                                reject_unauthorized = reject.as_boolean();
                            } else if reject.is_number() {
                                reject_unauthorized = reject.to_int32() != 0;
                            }
                        }

                        if global_this.has_exception() {
                            is_error = true;
                            return Ok(JSValue::ZERO);
                        }

                        if let Some(check_server_identity_) =
                            tls.get(ctx, "checkServerIdentity")?
                        {
                            if check_server_identity_.is_cell()
                                && check_server_identity_.is_callable()
                            {
                                check_server_identity = check_server_identity_;
                            }
                        }

                        if global_this.has_exception() {
                            is_error = true;
                            return Ok(JSValue::ZERO);
                        }

                        match SSLConfig::from_js(vm, global_this, tls) {
                            Err(_) => {
                                is_error = true;
                                return Ok(JSValue::ZERO);
                            }
                            Ok(Some(config)) => {
                                // Intern via GlobalRegistry for deduplication and pointer equality
                                break 'extract_ssl_config Some(
                                    ssl_config_intern_for_http(config),
                                );
                            }
                            Ok(None) => {}
                        }
                    }
                }
            }
        }

        break 'extract_ssl_config ssl_config;
    };

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // unix: string | undefined
    unix_socket_path = 'extract_unix_socket_path: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

        // PERF(port): was `inline for` — plain loop, profile in Phase B
        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(socket_path) = obj.get(global_this, "unix")? {
                    if socket_path.is_string() && socket_path.get_length(ctx)? > 0 {
                        // PORT NOTE: Zig `toSliceCloneWithAllocator` ≈ `to_slice_clone`.
                        break 'extract_unix_socket_path socket_path.to_slice_clone(global_this)?;
                    }
                }

                if global_this.has_exception() {
                    is_error = true;
                    return Ok(JSValue::ZERO);
                }
            }
        }
        break 'extract_unix_socket_path unix_socket_path;
    };

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // protocol: "http2" | "h2" | "http1.1" | "h1" | undefined.
    'extract_protocol: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];
        // PERF(port): was `inline for` — plain loop, profile in Phase B
        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(protocol_val) = obj.get(global_this, "protocol")? {
                    if protocol_val.is_string() {
                        let str = protocol_val.to_bun_string(global_this)?;
                        // PORT NOTE: `defer str.deref()` → Drop.
                        if str.eql_comptime(b"http2") || str.eql_comptime(b"h2") {
                            force_http2 = true;
                        } else if str.eql_comptime(b"http3") || str.eql_comptime(b"h3") {
                            force_http3 = true;
                        } else if str.eql_comptime(b"http1.1") || str.eql_comptime(b"h1") {
                            force_http1 = true;
                        } else {
                            is_error = true;
                            return Err(global_this.throw_invalid_arguments(
                                format_args!("fetch: 'protocol' must be \"http2\", \"h2\", \"http3\", \"h3\", \"http1.1\", or \"h1\""),
                            ));
                        }
                        break 'extract_protocol;
                    }
                }
            }
        }
    }

    // timeout: false | number | undefined
    disable_timeout = 'extract_disable_timeout: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

        // PERF(port): was `inline for` — plain loop, profile in Phase B
        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(timeout_value) = obj.get(global_this, "timeout")? {
                    if timeout_value.is_boolean() {
                        break 'extract_disable_timeout !timeout_value.as_boolean();
                    } else if timeout_value.is_number() {
                        break 'extract_disable_timeout timeout_value.to_int32() == 0;
                    }
                }

                if global_this.has_exception() {
                    is_error = true;
                    return Ok(JSValue::ZERO);
                }
            }
        }

        break 'extract_disable_timeout disable_timeout;
    };

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // redirect: "follow" | "error" | "manual" | undefined;
    redirect_type = 'extract_redirect_type: {
        // First, try to use the Request object's redirect if available
        if let Some(req) = request_mut!() {
            redirect_type = req.flags.redirect;
        }

        // Then check options/init objects which can override the Request's redirect
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

        // PERF(port): was `inline for` — plain loop, profile in Phase B
        for obj in objects_to_try {
            if !obj.is_empty() {
                match obj.get_optional_enum::<FetchRedirect>(global_this, "redirect") {
                    Err(_) => {
                        is_error = true;
                        return Ok(JSValue::ZERO);
                    }
                    Ok(Some(redirect_value)) => {
                        break 'extract_redirect_type redirect_value;
                    }
                    Ok(None) => {}
                }
            }
        }

        break 'extract_redirect_type redirect_type;
    };

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // keepalive: boolean | undefined;
    disable_keepalive = 'extract_disable_keepalive: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

        // PERF(port): was `inline for` — plain loop, profile in Phase B
        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(keepalive_value) = obj.get(global_this, "keepalive")? {
                    if keepalive_value.is_boolean() {
                        break 'extract_disable_keepalive !keepalive_value.as_boolean();
                    } else if keepalive_value.is_number() {
                        break 'extract_disable_keepalive keepalive_value.to_int32() == 0;
                    }
                }

                if global_this.has_exception() {
                    is_error = true;
                    return Ok(JSValue::ZERO);
                }
            }
        }

        break 'extract_disable_keepalive disable_keepalive;
    };

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // verbose: boolean | "curl" | undefined;
    verbose = 'extract_verbose: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

        // PERF(port): was `inline for` — plain loop, profile in Phase B
        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(verb) = obj.get(global_this, "verbose")? {
                    if verb.is_string() {
                        if verb.get_zig_string(global_this)?.eql_comptime(b"curl") {
                            break 'extract_verbose http::HTTPVerboseLevel::Curl;
                        }
                    } else if verb.is_boolean() {
                        break 'extract_verbose if verb.to_boolean() {
                            http::HTTPVerboseLevel::Headers
                        } else {
                            http::HTTPVerboseLevel::None
                        };
                    }
                }

                if global_this.has_exception() {
                    is_error = true;
                    return Ok(JSValue::ZERO);
                }
            }
        }
        break 'extract_verbose verbose;
    };

    // proxy: string | { url: string, headers?: Headers } | undefined;
    let mut proxy_headers: Option<Headers> = None;
    // PORT NOTE: `defer if (proxy_headers) |*hdrs| hdrs.deinit();` → Headers impls Drop.
    url_proxy_buffer = 'extract_proxy: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];
        // PERF(port): was `inline for` — plain loop, profile in Phase B
        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(proxy_arg) = obj.get(global_this, "proxy")? {
                    // Handle string format: proxy: "http://proxy.example.com:8080"
                    if proxy_arg.is_string() && proxy_arg.get_length(ctx)? > 0 {
                        let href = jsc::URL::href_from_js(proxy_arg, global_this)?;
                        if href.tag() == BunStringTag::Dead {
                            let err = ctx.to_type_error(
                                jsc::ErrorCode::INVALID_ARG_VALUE,
                                "fetch() proxy URL is invalid",
                            );
                            is_error = true;
                            return Ok(
                                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                    global_this, err,
                                ),
                            );
                        }
                        // PORT NOTE: `defer href.deref()` → Drop.
                        // std.fmt.allocPrint(allocator, "{s}{f}", .{ url_proxy_buffer, href })
                        let mut buffer: Vec<u8> = Vec::with_capacity(url_proxy_buffer.len());
                        buffer.extend_from_slice(&url_proxy_buffer);
                        write!(&mut buffer, "{}", href).expect("write to Vec cannot fail");
                        let url_len = url.href.len();
                        url = parse_url_detached!(&buffer[0..url_len]);
                        if url.is_file() {
                            url_type = URLType::File;
                        } else if url.is_blob() {
                            url_type = URLType::Blob;
                        }

                        proxy = Some(parse_url_detached!(&buffer[url_len..]));
                        // PORT NOTE: allocator.free(url_proxy_buffer) — old Vec dropped on reassign.
                        break 'extract_proxy buffer;
                    }
                    // Handle object format: proxy: { url: "http://proxy.example.com:8080", headers?: Headers }
                    // If the proxy object doesn't have a 'url' property, ignore it.
                    // This handles cases like passing a URL object directly as proxy (which has 'href' not 'url').
                    if proxy_arg.is_object() {
                        // Get the URL from the proxy object
                        if let Some(proxy_url_arg) = proxy_arg.get(global_this, "url")? {
                            if !proxy_url_arg.is_undefined_or_null() {
                                if proxy_url_arg.is_string()
                                    && proxy_url_arg.get_length(ctx)? > 0
                                {
                                    let href =
                                        jsc::URL::href_from_js(proxy_url_arg, global_this)?;
                                    if href.tag() == BunStringTag::Dead {
                                        let err = ctx.to_type_error(
                                            jsc::ErrorCode::INVALID_ARG_VALUE,
                                            "fetch() proxy URL is invalid",
                                        );
                                        is_error = true;
                                        return Ok(
                                            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                                global_this, err,
                                            ),
                                        );
                                    }
                                    // PORT NOTE: `defer href.deref()` → Drop.
                                    let mut buffer: Vec<u8> =
                                        Vec::with_capacity(url_proxy_buffer.len());
                                    buffer.extend_from_slice(&url_proxy_buffer);
                                    write!(&mut buffer, "{}", href)
                                        .expect("write to Vec cannot fail");
                                    let url_len = url.href.len();
                                    url = parse_url_detached!(&buffer[0..url_len]);
                                    if url.is_file() {
                                        url_type = URLType::File;
                                    } else if url.is_blob() {
                                        url_type = URLType::Blob;
                                    }

                                    proxy = Some(parse_url_detached!(&buffer[url_len..]));
                                    // PORT NOTE: allocator.free(url_proxy_buffer) — old Vec dropped on reassign.
                                    url_proxy_buffer = buffer;

                                    // Get the headers from the proxy object (optional)
                                    if let Some(headers_value) =
                                        proxy_arg.get(global_this, "headers")?
                                    {
                                        if !headers_value.is_undefined_or_null() {
                                            if let Some(fetch_hdrs) =
                                                FetchHeaders::cast(headers_value)
                                            {
                                                // SAFETY: cast returns a live FetchHeaders*.
                                                let fetch_hdrs = unsafe { fetch_hdrs.as_ref() };
                                                proxy_headers = Some(Headers::from(
                                                    Some(fetch_headers_ref(fetch_hdrs)),
                                                    HeadersOptions::default(),
                                                ));
                                            } else if let Some(fetch_hdrs) =
                                                FetchHeaders::create_from_js(ctx, headers_value)?
                                            {
                                                // SAFETY: create_from_js returns a +1-ref NonNull<FetchHeaders>.
                                                let fetch_hdrs_ref = unsafe { fetch_hdrs.as_ref() };
                                                proxy_headers = Some(Headers::from(
                                                    Some(fetch_headers_ref(fetch_hdrs_ref)),
                                                    HeadersOptions::default(),
                                                ));
                                                // PORT NOTE: `defer fetch_hdrs.deref()` — release the +1 ref.
                                                // SAFETY: paired with the create_from_js +1 ref above.
                                                unsafe { (*fetch_hdrs.as_ptr()).deref() };
                                            }
                                        }
                                    }

                                    break 'extract_proxy url_proxy_buffer;
                                } else {
                                    let err = ctx.to_type_error(
                                        jsc::ErrorCode::INVALID_ARG_VALUE,
                                        "fetch() proxy.url must be a non-empty string",
                                    );
                                    is_error = true;
                                    return Ok(
                                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                            global_this, err,
                                        ),
                                    );
                                }
                            }
                        }
                    }
                }

                if global_this.has_exception() {
                    is_error = true;
                    return Ok(JSValue::ZERO);
                }
            }
        }

        break 'extract_proxy url_proxy_buffer;
    };

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // signal: AbortSignal | undefined;
    signal = 'extract_signal: {
        if let Some(options) = options_object {
            if let Some(signal_) = options.get(global_this, "signal")? {
                if !signal_.is_undefined() {
                    if let Some(signal__) = AbortSignal::from_js(signal_) {
                        // SAFETY: from_js returns a live AbortSignal*; ref_ bumps refcount.
                        break 'extract_signal NonNull::new(unsafe { (*signal__).ref_() });
                    }
                }
            }

            if global_this.has_exception() {
                is_error = true;
                return Ok(JSValue::ZERO);
            }
        }

        if let Some(req) = request_mut!() {
            if let Some(signal_) = &req.signal {
                break 'extract_signal NonNull::new(signal_.ref_());
            }
            break 'extract_signal None;
        }

        if let Some(options) = request_init_object {
            if let Some(signal_) = options.get(global_this, "signal")? {
                if signal_.is_undefined() {
                    break 'extract_signal None;
                }

                if let Some(signal__) = AbortSignal::from_js(signal_) {
                    // SAFETY: from_js returns a live AbortSignal*; ref_ bumps refcount.
                    break 'extract_signal NonNull::new(unsafe { (*signal__).ref_() });
                }
            }
        }

        break 'extract_signal None;
    };

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // We do this 2nd to last instead of last so that if it's a FormData
    // object, we can still insert the boundary.
    //
    // body: BodyInit | null | undefined;
    //
    body = 'extract_body: {
        if let Some(options) = options_object {
            if let Some(body__) = options.fast_get(global_this, jsc::BuiltinName::Body)? {
                if !body__.is_undefined() {
                    break 'extract_body Some(HTTPRequestBody::from_js(ctx, body__)?);
                }
            }

            if global_this.has_exception() {
                is_error = true;
                return Ok(JSValue::ZERO);
            }
        }

        if let Some(req) = request_mut!() {
            let body_value = req.get_body_value();
            let already_used = match body_value {
                BodyValue::Used => true,
                BodyValue::Locked(locked) => {
                    locked.action != BodyValueLockedAction::None
                        || locked.is_disturbed::<Request>(global_this, first_arg)
                }
                _ => false,
            };
            if already_used {
                return Err(global_this
                    .err(jsc::ErrorCode::BODY_ALREADY_USED, format_args!("Request body already used"))
                    .throw());
            }

            if matches!(*body_value, BodyValue::Locked(_)) {
                if let Some(readable) = req.get_body_readable_stream(global_this) {
                    break 'extract_body Some(HTTPRequestBody::ReadableStream(
                        readable_stream::Strong::init(readable, global_this),
                    ));
                }
                let body_value = req.get_body_value();
                if let BodyValue::Locked(locked) = body_value {
                    if locked.readable.has() {
                        break 'extract_body Some(HTTPRequestBody::ReadableStream(
                            readable_stream::Strong::init(
                                locked.readable.get(global_this).unwrap(),
                                global_this,
                            ),
                        ));
                    }
                }
                let readable = body_value.to_readable_stream(global_this)?;
                if !readable.is_empty_or_undefined_or_null() {
                    if let BodyValue::Locked(locked) = body_value {
                        if locked.readable.has() {
                            break 'extract_body Some(HTTPRequestBody::ReadableStream(
                                readable_stream::Strong::init(
                                    locked.readable.get(global_this).unwrap(),
                                    global_this,
                                ),
                            ));
                        }
                    }
                }
            }

            break 'extract_body Some(HTTPRequestBody::AnyBlob(req.get_body_value().use_as_any_blob()));
        }

        if let Some(req) = request_init_object {
            if let Some(body__) = req.fast_get(global_this, jsc::BuiltinName::Body)? {
                if !body__.is_undefined() {
                    break 'extract_body Some(HTTPRequestBody::from_js(ctx, body__)?);
                }
            }
        }

        break 'extract_body None;
    }
    .unwrap_or_default();

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // headers: Headers | undefined;
    headers = 'extract_headers: {
        let mut fetch_headers_to_deref: Option<*mut FetchHeaders> = None;
        // TODO(port): errdefer — Zig deferred `fetch_headers_to_deref.deref()`. Borrowck
        // forbids the by-ref scopeguard here; deref is done explicitly after use below.

        let fetch_headers: Option<*mut FetchHeaders> = 'brk: {
            if let Some(options) = options_object {
                if let Some(headers_value) =
                    options.fast_get(global_this, jsc::BuiltinName::Headers)?
                {
                    if !headers_value.is_undefined() {
                        if let Some(headers__) = FetchHeaders::cast(headers_value) {
                            // SAFETY: cast returns a live FetchHeaders*.
                            if unsafe { (*headers__.as_ptr()).is_empty() } {
                                break 'brk None;
                            }
                            break 'brk Some(headers__.as_ptr());
                        }

                        if let Some(headers__) = FetchHeaders::create_from_js(ctx, headers_value)?
                        {
                            fetch_headers_to_deref = Some(headers__.as_ptr());
                            break 'brk Some(headers__.as_ptr());
                        }

                        break 'brk None;
                    }
                }

                if global_this.has_exception() {
                    is_error = true;
                    return Ok(JSValue::ZERO);
                }
            }

            if let Some(req) = request_mut!() {
                if let Some(head) = req.get_fetch_headers_unless_empty() {
                    break 'brk Some(head.as_ptr());
                }
                break 'brk None;
            }

            if let Some(options) = request_init_object {
                if let Some(headers_value) =
                    options.fast_get(global_this, jsc::BuiltinName::Headers)?
                {
                    if !headers_value.is_undefined() {
                        if let Some(headers__) = FetchHeaders::cast(headers_value) {
                            // SAFETY: cast returns a live FetchHeaders*.
                            if unsafe { (*headers__.as_ptr()).is_empty() } {
                                break 'brk None;
                            }
                            break 'brk Some(headers__.as_ptr());
                        }

                        if let Some(headers__) = FetchHeaders::create_from_js(ctx, headers_value)?
                        {
                            fetch_headers_to_deref = Some(headers__.as_ptr());
                            break 'brk Some(headers__.as_ptr());
                        }

                        break 'brk None;
                    }
                }
            }

            if global_this.has_exception() {
                is_error = true;
                return Ok(JSValue::ZERO);
            }

            break 'extract_headers headers;
        };

        if global_this.has_exception() {
            is_error = true;
            return Ok(JSValue::ZERO);
        }

        let result = if let Some(headers_) = fetch_headers {
            // SAFETY: headers_ points to a live FetchHeaders (either JS-owned or
            // refcounted via fetch_headers_to_deref above).
            let headers_ref = unsafe { &mut *headers_ };
            if let Some(hostname_) = headers_ref.fast_get(HTTPHeaderName::Host) {
                hostname = Some(hostname_.to_owned_slice_z());
            }
            if url.is_s3() {
                if let Some(range_) = headers_ref.fast_get(HTTPHeaderName::Range) {
                    range = Some(range_.to_owned_slice_z());
                }
            }

            if let Some(upgrade_) = headers_ref.fast_get(HTTPHeaderName::Upgrade) {
                let upgrade = upgrade_.to_slice();
                // PORT NOTE: `defer upgrade.deinit()` → Drop.
                let slice = upgrade.slice();
                if slice != b"h2" && slice != b"h2c" {
                    upgraded_connection = true;
                }
            }

            Some(Headers::from(
                Some(fetch_headers_ref(headers_ref)),
                HeadersOptions {
                    body: any_blob_ref_opt(body.get_any_blob().map(|b| &*b)),
                },
            ))
        } else {
            headers
        };

        // PORT NOTE: deferred `fetch_headers_to_deref.deref()` (release +1 from create_from_js).
        if let Some(fh) = fetch_headers_to_deref {
            // SAFETY: fh was obtained from create_from_js which returns +1 ref.
            unsafe { (*fh).deref() };
        }

        break 'extract_headers result;
    };

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    if proxy.is_some() && !unix_socket_path.slice().is_empty() {
        is_error = true;
        let err = ctx.to_type_error(jsc::ErrorCode::INVALID_ARG_VALUE, FETCH_ERROR_PROXY_UNIX);
        return Ok(
            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            ),
        );
    }

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // This is not 100% correct.
    // We don't pass along headers, we ignore method, we ignore status code...
    // But it's better than status quo.
    if url_type != URLType::Remote {
        // PORT NOTE: `defer unix_socket_path.deinit()` → Drop on scope exit.
        let mut path_buf = PathBuffer::uninit();
        let mut path_buf2 = PathBuffer::uninit();
        // TODO(port): std.io.fixedBufferStream + PercentEncoding.decode writer plumbing.
        // The Zig threads a writer over path_buf2; here we call a slice-based decode.
        let decoded_len = match PercentEncoding::decode_into(
            &mut path_buf2[..],
            match url_type {
                URLType::File => url.path,
                URLType::Blob => &url.href[b"blob:".len()..],
                URLType::Remote => unreachable!(),
            },
        ) {
            Ok(n) => n,
            Err(err) => {
                return Err(global_this.throw_error(err.into(), "Failed to decode file url"));
            }
        };
        #[allow(unused_mut)]
        let mut url_path_decoded = &path_buf2[0..decoded_len as usize];

        let mut url_string: BunString = BunString::empty();
        // PORT NOTE: `defer url_string.deref()` → Drop.

        // This can be a blob: url or a file: url.
        let blob_to_use: Blob = 'blob: {
            // Support blob: urls
            if url_type == URLType::Blob {
                if let Some(blob) =
                    ObjectURLRegistry::singleton().resolve_and_dupe(url_path_decoded)
                {
                    url_string = BunString::create_format(format_args!(
                        "blob:{}",
                        bstr::BStr::new(url_path_decoded)
                    ));
                    break 'blob blob;
                } else {
                    // Consistent with what Node.js does - it rejects, not a 404.
                    let err = global_this.to_type_error_fmt(
                        jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!(
                            "Failed to resolve blob:{}",
                            bstr::BStr::new(url_path_decoded)
                        ),
                    );
                    is_error = true;
                    return Ok(
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err,
                        ),
                    );
                }
            }

            let temp_file_path: &[u8] = 'brk: {
                if bun_paths::is_absolute(url_path_decoded) {
                    #[cfg(windows)]
                    {
                        // pathname will start with / if is a absolute path on windows, so we remove before normalizing it
                        if url_path_decoded[0] == b'/' {
                            url_path_decoded = &url_path_decoded[1..];
                        }
                        break 'brk match PosixToWinNormalizer::resolve_cwd_with_external_buf_z(
                            &mut path_buf,
                            url_path_decoded,
                        ) {
                            Ok(p) => p,
                            Err(err) => {
                                return global_this
                                    .throw_error(err, "Failed to resolve file url");
                            }
                        };
                    }
                    #[cfg(not(windows))]
                    {
                        break 'brk url_path_decoded;
                    }
                }

                #[cfg(windows)]
                let mut cwd_buf = PathBuffer::uninit();
                #[cfg(windows)]
                let cwd = match bun_sys::getcwd(&mut cwd_buf) {
                    Ok(c) => c,
                    Err(err) => {
                        return global_this.throw_error(err, "Failed to resolve file url");
                    }
                };
                #[cfg(not(windows))]
                // SAFETY: bun_vm() returns the live thread-local VM pointer; `transpiler.fs`
                // is a raw `*mut FileSystem` set during init.
                let cwd = unsafe { (*(*global_this.bun_vm()).transpiler.fs).top_level_dir };

                // SAFETY: bun_vm() returns the live thread-local VM pointer.
                let main = unsafe { (*global_this.bun_vm()).main };
                let fullpath = bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
                    cwd,
                    &mut path_buf,
                    &[main, b"../", url_path_decoded],
                );
                #[cfg(windows)]
                {
                    break 'brk match PosixToWinNormalizer::resolve_cwd_with_external_buf_z(
                        &mut path_buf2,
                        fullpath,
                    ) {
                        Ok(p) => p,
                        Err(err) => {
                            return global_this.throw_error(err, "Failed to resolve file url");
                        }
                    };
                }
                #[cfg(not(windows))]
                {
                    break 'brk fullpath;
                }
            };

            url_string = jsc::URL::file_url_from_string(BunString::borrow_utf8(temp_file_path));

            // PORT NOTE: `find_or_create_file_from_path` is typed against the
            // `crate::webcore::node_types` stub (until it's swapped to a
            // re-export of `crate::node::types`); construct that variant here.
            let mut pathlike = crate::webcore::node_types::PathOrFileDescriptor::Path(
                crate::webcore::node_types::PathLike::EncodedSlice(ZigStringSlice::init_owned(temp_file_path.to_vec())),
            );

            break 'blob Blob::find_or_create_file_from_path(&mut pathlike, global_this, true);
        };

        let mut response = Box::new(Response::init(
            response::Init {
                status_code: 200,
                ..Default::default()
            },
            Body {
                value: BodyValue::Blob(blob_to_use),
            },
            url_string.clone(),
            false,
        ));

        return Ok(JSPromise::resolved_promise_value(
            global_this,
            response.to_js(global_this),
        ));
    }

    if !url.protocol.is_empty() {
        if !(url.is_http() || url.is_https() || url.is_s3()) {
            let err = global_this.to_type_error(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                "protocol must be http:, https: or s3:",
            );
            is_error = true;
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    err,
                ),
            );
        }
    }

    if !ALLOW_GET_BODY && !method.has_request_body() && body.has_body() && !upgraded_connection {
        let err = global_this.to_type_error(
            jsc::ErrorCode::INVALID_ARG_VALUE,
            FETCH_ERROR_UNEXPECTED_BODY,
        );
        is_error = true;
        return Ok(
            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            ),
        );
    }

    if headers.is_none() && body.has_body() && body.has_content_type_from_user() {
        headers = Some(Headers::from(
            None,
            HeadersOptions {
                body: any_blob_ref_opt(body.get_any_blob().map(|b| &*b)),
            },
        ));
    }

    // PORT NOTE: Zig kept a separate `http_body = body` shallow alias and later
    // detached `body` after `FetchTasklet.queue`. With Rust move semantics the
    // alias is unnecessary: `body` is mutated in place for the sendfile/readfile
    // paths and then *moved* into `FetchOptions`, so the trailing `body.detach()`
    // and the debug ref-count check that depended on the alias are dropped.

    if body.is_s3() {
        'prepare_body: {
            // is a S3 file we can use chunked here

            if let Some(stream) = ReadableStream::from_js(
                ReadableStream::from_blob_copy_ref(
                    global_this,
                    body.any_blob().blob(),
                    s3::MultiPartUploadOptions::DEFAULT_PART_SIZE as crate::webcore::blob::SizeType,
                )?,
                global_this,
            )? {
                let old = core::mem::replace(
                    &mut body,
                    HTTPRequestBody::ReadableStream(readable_stream::Strong::init(
                        stream,
                        global_this,
                    )),
                );
                drop(old); // PORT NOTE: `defer old.detach()` → Drop.
                break 'prepare_body;
            }
            let rejected_value =
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    global_this.create_error_instance("Failed to start s3 stream"),
                );
            drop(body);
            return Ok(rejected_value);
        }
    }
    if body.needs_to_read_file() {
        'prepare_body: {
            // TODO(port): `body.store().data.file.pathlike` reaches through several
            // not-yet-stabilized fields (`BlobStore.data.file` is gated). Stub the
            // syscall path until BlobStore::data is un-gated.
            let opened_fd_res: bun_sys::Result<bun_core::Fd> = {
                let _ = &body;
                todo!("blocked_on: crate::webcore::blob::Store.data.file.pathlike")
            };

            let opened_fd = match opened_fd_res {
                Err(err) => {
                    let err_js = err.to_js(global_this);
                    let rejected_value =
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err_js,
                        );
                    is_error = true;
                    return Ok(rejected_value);
                }
                Ok(fd) => fd,
            };

            if proxy.is_none() && http::SendFile::is_eligible(&url) {
                'use_sendfile: {
                    let stat: bun_sys::Stat = match bun_sys::fstat(opened_fd) {
                        Ok(result) => result,
                        // bail out for any reason
                        Err(_) => break 'use_sendfile,
                    };

                    #[cfg(target_os = "macos")]
                    {
                        // macOS only supports regular files for sendfile()
                        if !bun_sys::S::ISREG(stat.st_mode) {
                            break 'use_sendfile;
                        }
                    }

                    // if it's < 32 KB, it's not worth it
                    if stat.st_size < 32 * 1024 {
                        break 'use_sendfile;
                    }

                    let original_size = body.any_blob().blob().size;
                    let stat_size = blob::SizeType::try_from(stat.st_size).unwrap();
                    let blob_size = if bun_sys::S::ISREG(stat.st_mode) {
                        stat_size
                    } else {
                        original_size.min(stat_size)
                    };

                    // PORT NOTE: `http::SendFile` fields are `usize`; blob sizes/offsets
                    // are `blob::SizeType` (u64). Zig's `@intCast` ↔ `as usize` here.
                    http_body = HTTPRequestBody::Sendfile(http::SendFile {
                        fd: opened_fd,
                        remain: (body.any_blob().blob().offset + original_size) as usize,
                        offset: body.any_blob().blob().offset as usize,
                        content_size: blob_size as usize,
                    });

                    if bun_sys::S::ISREG(stat.st_mode) {
                        let stat_size_usize = stat_size as usize;
                        let sf = http_body.sendfile_mut();
                        sf.offset = sf.offset.min(stat_size_usize);
                        sf.remain = sf
                            .remain
                            .max(sf.offset)
                            .min(stat_size_usize)
                            .saturating_sub(sf.offset);
                    }
                    body.detach();

                    break 'prepare_body;
                }
            }

            // TODO: make this async + lazy
            // TODO(port): node::fs::NodeFS::read_file + node_fs() field reach-through
            // (`.sync_error_buf`, `BlobStore.data.file.pathlike`) are gated.
            let _ = opened_fd;
            body.detach();
            body = HTTPRequestBody::AnyBlob(blob::Any::from_owned_slice(Vec::new()));
            http_body = body.clone_ref();
            todo!("blocked_on: crate::node::fs::NodeFS::read_file");
            #[allow(unreachable_code)]
            { break 'prepare_body; }
        }
    }

    if url.is_s3() {
        // get ENV config
        // TODO(port): `S3CredentialsWithOptions` is non-Default upstream; build via shim.
        let mut credentials_with_options: s3::S3CredentialsWithOptions = {
            // SAFETY: bun_vm() returns the live thread-local VM pointer.
            let _env = unsafe { &(*global_this.bun_vm()).transpiler.env };
            todo!("blocked_on: bun_s3_signing::S3CredentialsWithOptions::default + DotEnv::get_s3_credentials")
        };
        // PORT NOTE: `defer credentialsWithOptions.deinit()` → Drop.

        if let Some(options) = options_object {
            if let Some(s3_options) = options.get_truthy(global_this, "s3")? {
                let s3_options: JSValue = s3_options;
                if s3_options.is_object() {
                    s3_options.ensure_still_alive();
                    credentials_with_options = s3::S3Credentials::get_credentials_with_options(
                        &credentials_with_options.credentials,
                        Default::default(),
                        Some(s3_options),
                        None,
                        None,
                        false,
                        global_this,
                    )?;
                }
            }
        }

        if let HTTPRequestBody::ReadableStream(ref readable_stream) = body {
            // we cannot direct stream to s3 we need to use multi part upload
            // PORT NOTE: `defer body.ReadableStream.deinit()` → Drop on `body` scope exit.

            if method != Method::PUT && method != Method::POST {
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        global_this.create_error_instance(
                            "Only POST and PUT do support body when using S3",
                        ),
                    ),
                );
            }
            let promise = jsc::JSPromiseStrong::init(global_this);
            let promise_value = promise.value();

            let s3_stream = Box::new(S3StreamWrapper {
                url,
                url_proxy_buffer: url_proxy_buffer.into_boxed_slice(),
                // TODO(port): JSPromiseStrong has no clone_ref(); the original Zig
                // moved the strong ref into the wrapper after grabbing `.value()`.
                promise,
                global: global_this,
            });

            let proxy_url: Option<&[u8]> = proxy.as_ref().map(|p| p.href);
            // Shim: Zig used `@ptrCast(&Wrapper.resolve)` to erase both the
            // `*@This()` payload type and the `JSTerminated!void` error union when
            // coercing to `?*const fn (S3UploadResult, *anyopaque) void`. In Rust we
            // can't safely transmute away the `Result` return, so erase it explicitly.
            fn s3_stream_wrapper_resolve(
                result: s3::S3UploadResult<'_>,
                ctx: *mut libc::c_void,
            ) {
                // SAFETY: ctx was produced by `Box::into_raw(s3_stream)` below; the
                // 'static lifetime is a raw-pointer fiction matching the Zig @ptrCast.
                let _ = S3StreamWrapper::resolve(result, ctx as *mut S3StreamWrapper<'static>);
            }
            let _ = s3::upload_stream(
                &mut credentials_with_options.credentials,
                url.s3_path(),
                readable_stream.get(global_this).unwrap(),
                global_this,
                credentials_with_options.options,
                credentials_with_options.acl,
                credentials_with_options.storage_class,
                headers.as_ref().and_then(|h| h.get_content_type()),
                headers.as_ref().and_then(|h| h.get_content_disposition()),
                headers.as_ref().and_then(|h| h.get_content_encoding()),
                proxy_url,
                credentials_with_options.request_payer,
                Some(s3_stream_wrapper_resolve),
                Box::into_raw(s3_stream) as *mut libc::c_void,
            )?;
            // PORT NOTE: url/url_proxy_buffer ownership moved into s3_stream above.
            url = ZigURL::default();
            url_proxy_buffer = Vec::new();
            return Ok(promise_value);
        }
        if method == Method::POST {
            method = Method::PUT;
        }

        // PORT NOTE: `SignOptions` is non-Default upstream; build a minimal one.
        let sign_opts: SignOptions = {
            let _ = (url.s3_path(), method);
            todo!("blocked_on: bun_s3_signing::SignOptions::default")
        };
        let mut result = match credentials_with_options.credentials.sign_request::<false>(
            sign_opts,
            None,
        ) {
            Ok(r) => r,
            Err(sign_err) => {
                is_error = true;
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        s3::get_js_sign_error(sign_err.into(), global_this),
                    ),
                );
            }
        };
        // PORT NOTE: `defer result.deinit()` → Drop.

        if let Some(proxy_) = &proxy {
            // proxy and url are in the same buffer lets replace it
            let old_buffer = core::mem::take(&mut url_proxy_buffer);
            // PORT NOTE: `defer allocator.free(old_buffer)` → drop(old_buffer) at end of scope.
            let mut buffer = vec![0u8; result.url.len() + proxy_.href.len()];
            buffer[0..result.url.len()].copy_from_slice(&result.url);
            // TODO(port): Zig has `buffer[proxy_.href.len..]` which looks like a bug
            // (should be `buffer[result.url.len..]`). Preserved verbatim for Phase B review.
            buffer[proxy_.href.len()..].copy_from_slice(proxy_.href);
            url_proxy_buffer = buffer;

            url = ZigURL::parse(&url_proxy_buffer[0..result.url.len()]);
            proxy = Some(ZigURL::parse(&url_proxy_buffer[result.url.len()..]));
            drop(old_buffer);
        } else {
            // replace headers and url of the request
            // PORT NOTE: allocator.free(url_proxy_buffer) — old Vec dropped on reassign.
            url_proxy_buffer = core::mem::take(&mut result.url).into();
            url = ZigURL::parse(&url_proxy_buffer);
            // result.url = ""; — fetch now owns this (mem::take above)
        }

        let content_type = headers.as_ref().and_then(|h| h.get_content_type());
        let mut header_buffer: [picohttp::Header; SignResult::MAX_HEADERS + 1] =
            [picohttp::Header::ZERO; SignResult::MAX_HEADERS + 1];

        if let Some(range_) = &range {
            let new_headers = result.mix_with_header(
                &mut header_buffer,
                picohttp::Header::new(b"range", range_.as_bytes()),
            );
            set_headers(&mut headers, new_headers);
        } else if let Some(ct) = content_type {
            if !ct.is_empty() {
                let new_headers = result.mix_with_header(
                    &mut header_buffer,
                    picohttp::Header::new(b"Content-Type", ct),
                );
                set_headers(&mut headers, new_headers);
            } else {
                set_headers(&mut headers, result.headers());
            }
        } else {
            set_headers(&mut headers, result.headers());
        }
    }

    // Only create this after we have validated all the input.
    // or else we will leak it
    let promise = jsc::JSPromiseStrong::init(global_this);

    let promise_val = promise.value();

    #[cfg(debug_assertions)]
    let initial_body_reference_count: usize = {
        if let Some(store) = body.store() {
            store.ref_count.load(core::sync::atomic::Ordering::Relaxed) as usize
        } else {
            0
        }
    };

    // TODO(port): self-referential — `url`/`proxy` borrow `url_proxy_buffer`
    // which is moved into `FetchOptions` here. Zig's struct copy is fine; Rust
    // forbids it without `unsafe` lifetime erasure. FetchTasklet then re-parses
    // `url` from the owned buffer, so the borrow is sound in practice.
    let fetch_options: FetchOptions = {
        let _ = (
            method,
            url,
            headers.take(),
            http_body,
            disable_keepalive,
            disable_timeout,
            disable_decompression,
            reject_unauthorized,
            redirect_type,
            verbose,
            proxy.take(),
            proxy_headers.take(),
            core::mem::take(&mut url_proxy_buffer),
            signal.take().map(|p| p.as_ptr()),
            global_this,
            ssl_config.take(),
            hostname.take(),
            upgraded_connection,
            force_http2,
            force_http3,
            force_http1,
            if check_server_identity.is_empty_or_undefined_or_null() {
                jsc::strong::Optional::empty()
            } else {
                jsc::strong::Optional::create(check_server_identity, global_this)
            },
            core::mem::replace(&mut unix_socket_path, ZigStringSlice::empty()),
        );
        todo!("blocked_on: FetchOptions self-referential url/url_proxy_buffer (ZigURL<'static>)")
    };
    // SAFETY: `global_this` is the thread-local Bun global; it lives for the
    // process. `FetchTasklet::queue` stores it as `&'static`.
    let global_static: &'static JSGlobalObject =
        unsafe { core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(global_this) };
    let _ = FetchTasklet::queue(
        global_static,
        fetch_options,
        // Pass the Strong value instead of creating a new one, or else we
        // will leak it
        // see https://github.com/oven-sh/bun/issues/2985
        promise,
    );
    // PORT NOTE: `catch |err| bun.handleOom(err)` — FetchTasklet::queue aborts on OOM.

    #[cfg(debug_assertions)]
    {
        if let Some(store) = body.store() {
            if store.ref_count.load(core::sync::atomic::Ordering::Relaxed) as usize
                == initial_body_reference_count
            {
                Output::panic(format_args!("Expected body ref count to have incremented in FetchTasklet"));
            }
        }
    }

    // These are now owned by FetchTasklet.
    // PORT NOTE: in Zig these were re-assigned to empty so the `defer` block at the
    // top would not double-free. In Rust we used `.take()` / `mem::take` above to
    // move ownership into FetchTasklet::queue, so the locals are already empty.
    // Reference count for the blob is incremented above.
    if body.store().is_some() {
        body.detach();
    } else {
        // These are single-use, and have effectively been moved to the FetchTasklet.
        body = HTTPRequestBody::default();
    }

    Ok(promise_val)
}

// ──────────────────────────────────────────────────────────────────────────
// S3 ReadableStream upload Wrapper (was a fn-local struct in Zig)
// PORT NOTE: hoisted to module level — Rust does not allow `impl` blocks
// inside fn bodies for types referenced by external fn pointers.
// ──────────────────────────────────────────────────────────────────────────

struct S3StreamWrapper<'a> {
    promise: jsc::JSPromiseStrong,
    url: ZigURL<'a>,
    url_proxy_buffer: Box<[u8]>,
    // LIFETIMES.tsv: src/runtime/webcore/fetch.zig · Wrapper · global · JSC_BORROW → &JSGlobalObject
    global: &'a JSGlobalObject,
}

impl<'a> S3StreamWrapper<'a> {
    pub fn resolve(
        result: s3::S3UploadResult,
        self_: *mut Self,
    ) -> Result<(), bun_jsc::JsTerminated> {
        // SAFETY: self_ was created via Box::into_raw in fetch_impl; we reclaim
        // ownership here exactly once on the resolve callback.
        let mut self_ = unsafe { Box::from_raw(self_) };
        let global = self_.global;
        // PORT NOTE: `defer bun.destroy(self)` + `defer free(url_proxy_buffer)` →
        // Box<Self> and Box<[u8]> Drop at end of scope.
        match result {
            s3::S3UploadResult::Success => {
                let response = Box::new(Response::init(
                    response::Init {
                        method: Method::PUT,
                        status_code: 200,
                        ..Default::default()
                    },
                    Body {
                        value: BodyValue::Empty,
                    },
                    BunString::create_atom_if_possible(self_.url.href),
                    false,
                ));
                let response_js = Response::make_maybe_pooled(global, Box::into_raw(response));
                response_js.ensure_still_alive();
                self_.promise.resolve(global, response_js)?;
            }
            s3::S3UploadResult::Failure(err) => {
                let response = Box::new(Response::init(
                    response::Init {
                        method: Method::PUT,
                        status_code: 500,
                        status_text: BunString::create_atom_if_possible(err.code),
                        ..Default::default()
                    },
                    Body {
                        value: BodyValue::InternalBlob(InternalBlob {
                            bytes: err.message.to_vec(),
                            was_string: true,
                        }),
                    },
                    BunString::create_atom_if_possible(self_.url.href),
                    false,
                ));

                let response_js = Response::make_maybe_pooled(global, Box::into_raw(response));
                response_js.ensure_still_alive();
                self_.promise.resolve(global, response_js)?;
            }
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// setHeaders helper
// ──────────────────────────────────────────────────────────────────────────

fn set_headers(headers: &mut Option<Headers>, new_headers: &[picohttp::Header]) {
    let old = headers.take();
    *headers = Some(Headers::from_pico_http_headers(new_headers));
    // PORT NOTE: `if (old) |*h| h.deinit()` → Drop on `old`.
    drop(old);
}

} // mod _gated

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/fetch.zig (1526 lines)
//   confidence: medium
//   todos:      13
//   notes:      url_proxy_buffer/ZigURL borrow relationship + big defer-cleanup → Drop-based ownership needs Phase B borrowck audit; S3 Wrapper hoisted to module level with <'a> per LIFETIMES.tsv; possible upstream bug at fetch.zig:1373 preserved verbatim
// ──────────────────────────────────────────────────────────────────────────
