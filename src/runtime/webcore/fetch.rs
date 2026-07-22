// ──────────────────────────────────────────────────────────────────────────
// Error message constants
// ──────────────────────────────────────────────────────────────────────────

pub(crate) const FETCH_ERROR_NO_ARGS: &str = "fetch() expects a string but received no arguments.";
pub(crate) const FETCH_ERROR_BLANK_URL: &str = "fetch() URL must not be a blank string.";
pub(crate) const FETCH_ERROR_UNEXPECTED_BODY: &str =
    "fetch() request with GET/HEAD/OPTIONS method cannot have body.";
pub(crate) const FETCH_ERROR_PROXY_UNIX: &str = "fetch() cannot use a proxy with a unix socket.";

pub(crate) fn fetch_type_error_string(value: bun_jsc::JSValue) -> &'static str {
    if value.is_undefined() {
        "fetch() expects a string, but received Undefined"
    } else if value.is_null() {
        "fetch() expects a string, but received Null"
    } else if value.is_boolean() {
        "fetch() expects a string, but received Boolean"
    } else if value.is_number() {
        "fetch() expects a string, but received Number"
    } else if value.is_symbol() {
        "fetch() expects a string, but received Symbol"
    } else if value.is_big_int() {
        "fetch() expects a string, but received BigInt"
    } else if value.is_string_literal() {
        "fetch() expects a string, but received String"
    } else {
        "fetch() expects a string, but received Object"
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Re-export: FetchTasklet lives in ./fetch/FetchTasklet.rs
// ──────────────────────────────────────────────────────────────────────────

#[path = "fetch/FetchTasklet.rs"]
pub mod fetch_tasklet;

#[path = "fetch/compress_body.rs"]
pub mod compress_body;

// ──────────────────────────────────────────────────────────────────────────
// fetch() implementation
// ──────────────────────────────────────────────────────────────────────────

use core::ptr::NonNull;
use std::io::Write as _;

use crate::webcore::jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, VirtualMachine,
};
use bun_core::{String as BunString, Tag as BunStringTag, ZigStringSlice};
use bun_http::{self as http, FetchRedirect, Headers, HeadersExt as _, MimeType};
use bun_http_jsc::method_jsc;
use bun_http_types::Method::Method;
use bun_jsc::{HTTPHeaderName, StringJsc as _, SysErrorJsc as _};
use bun_paths::{self, PathBuffer};
use bun_sys::FdExt as _;
// `FromJsEnum for FetchRedirect` lives in bun_http_jsc; importing the impl crate
// brings the trait impl into scope for `JSValue::get_optional_enum::<FetchRedirect>`.
use crate::node;
use crate::node::types::PathLikeExt as _;
use crate::node::types::{Encoding, PathOrFileDescriptor};
use crate::socket::ssl_config::{SSLConfig, SSLConfigFromJs};
use crate::webcore::blob::BlobExt as _;
use crate::webcore::body::{Action as BodyValueLockedAction, InternalBlob, Value as BodyValue};
use crate::webcore::headers_ref::any_blob_content_type_opt;
use crate::webcore::s3::client as s3;
use crate::webcore::{
    AbortSignal, Blob, Body, FetchHeaders, ObjectURLRegistry, ReadableStream, Request, Response,
};
use crate::webcore::{blob, readable_stream, response};
use bun_http_jsc as _;
use bun_http_jsc::headers_jsc::from_fetch_headers;
#[cfg(windows)]
use bun_paths::resolve_path::PosixToWinNormalizer;
use bun_picohttp as picohttp;
use bun_resolver::data_url::DataURL;
use bun_s3_signing::{SignOptions, SignResult};
use bun_url::PercentEncoding;
use bun_url::URL as ZigURL;

pub use self::fetch_tasklet::FetchTasklet;
use self::fetch_tasklet::{FetchOptions, HTTPRequestBody};

// ──────────────────────────────────────────────────────────────────────────
// Local extension shims (upstream methods not yet ported / not in scope)
// ──────────────────────────────────────────────────────────────────────────

/// Intern an `SSLConfig` into the (single, canonical) `bun_http` registry.
/// DEDUP(D202): the runtime-tier struct and registry were folded into
/// `bun_http::ssl_config`, so this is now a thin alias — kept to avoid
/// churning the call site below.
#[inline]
fn ssl_config_intern_for_http(config: SSLConfig) -> http::ssl_config::SharedPtr {
    http::ssl_config::global_registry::intern(config)
}

/// Build the refcounted `bun_s3_signing::S3Credentials` from the lower-tier
/// `bun_dotenv::S3Credentials` POD mirror. The dotenv crate (T2) cannot name
/// `bun_s3_signing` types (would be an upward dep), so the conversion lives at
/// the call site here in T6.
pub(crate) fn s3_credentials_from_env(
    env: &bun_dotenv::S3Credentials,
) -> bun_s3_signing::S3Credentials {
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

/// RAII guard for the `+1` `AbortSignal` ref taken in `extract_signal`,
/// released on every exit path. `take()` disarms the guard when ownership is
/// handed to `FetchOptions`.
struct SignalRef(Option<NonNull<AbortSignal>>);
impl SignalRef {
    #[inline]
    fn take(&mut self) -> Option<*mut AbortSignal> {
        self.0.take().map(|p| p.as_ptr())
    }
}
impl Drop for SignalRef {
    fn drop(&mut self) {
        if let Some(sig) = self.0.take() {
            // `sig` was obtained from `AbortSignal::ref_()` which bumped the
            // C++ intrusive refcount; the pointee outlives this `BackRef`
            // until `unref()` releases that +1.
            bun_ptr::BackRef::from(sig).unref();
        }
    }
}

/// RAII guard for the `+1` `FetchHeaders` ref returned by
/// `FetchHeaders::create_from_js`; releases the ref on every exit path of
/// `extract_headers`.
struct FetchHeadersRef(Option<NonNull<FetchHeaders>>);
impl Drop for FetchHeadersRef {
    fn drop(&mut self) {
        if let Some(fh) = self.0.take() {
            // `fh` came from `FetchHeaders::create_from_js` which returns a
            // +1-ref `NonNull<FetchHeaders>`. `FetchHeaders` is an opaque ZST
            // FFI handle (S008) — safe `*mut → &mut` via `opaque_deref_mut`.
            bun_opaque::opaque_deref_mut(fh.as_ptr()).deref();
        }
    }
}

/// `Blob.Any` accessor shim.
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

/// `HTTPRequestBody` accessor shim missing from FetchTasklet.rs.
trait HTTPRequestBodyExt {
    fn any_blob(&self) -> &blob::Any;
}
impl HTTPRequestBodyExt for HTTPRequestBody {
    fn any_blob(&self) -> &blob::Any {
        match self {
            HTTPRequestBody::AnyBlob(b) => b,
            _ => unreachable!("HTTPRequestBody::any_blob() on non-AnyBlob"),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// dataURLResponse
// ──────────────────────────────────────────────────────────────────────────

fn data_url_response(data_url_: DataURL, global_this: &JSGlobalObject) -> JSValue {
    let data_url = data_url_;

    let data = match data_url.decode_data() {
        Ok(d) => d,
        Err(_) => {
            let err =
                global_this.create_error_instance(format_args!("failed to fetch the data URL"));
            return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            );
        }
    };
    let blob = Blob::init(data, global_this);

    let mime_type = MimeType::MimeType::init(data_url.mime_type, true, None);
    blob.content_type
        .set(crate::webcore::blob::BlobContentType::from(mime_type));

    let response = bun_core::heap::into_raw(Box::new(Response::init(
        response::Init {
            status_code: 200,
            status_text: BunString::create_atom(b"OK").into(),
            ..Default::default()
        },
        Body::new(BodyValue::Blob(blob)),
        data_url.url.dupe_ref(),
        false,
    )));

    // Ownership of the boxed Response is transferred to the JS GC via
    // `make_maybe_pooled` (which stores the raw `*mut Response` in the wrapper
    // and finalizes it). Dropping a `Box<Response>` here would be a UAF.
    JSPromise::resolved_promise_value(
        global_this,
        // SAFETY: `response` is a freshly allocated heap `Response`; ownership
        // transfers to JSC.
        Response::make_maybe_pooled(global_this, response),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Bun__fetchPreconnect
// ──────────────────────────────────────────────────────────────────────────

#[bun_jsc::host_fn(export = "Bun__fetchPreconnect")]
pub(crate) fn bun_fetch_preconnect(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<1>();
    let arguments = arguments.slice();

    if arguments.len() < 1 {
        return Err(global_object.throw_not_enough_arguments(
            "fetch.preconnect",
            1,
            arguments.len(),
        ));
    }

    // `href_from_js` returns a +1 (`Bun::toStringRef`). `bun_core::String` is
    // `Copy` with no `Drop`, so wrap in `OwnedString` for the scope-exit deref.
    let url_str = bun_core::OwnedString::new(jsc::URL::href_from_js(arguments[0], global_object)?);

    if url_str.tag() == BunStringTag::Dead {
        return Err(global_object
            .err(
                jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("Invalid URL"),
            )
            .throw());
    }

    if url_str.is_empty() {
        return Err(global_object
            .err(
                jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("{}", FETCH_ERROR_BLANK_URL),
            )
            .throw());
    }

    // bun.handleOom(url_str.toOwnedSlice(...)) → to_owned_slice() aborts on OOM.
    // `preconnect` takes a `URL<'static>` that borrows a `Box<[u8]>` href and
    // assumes ownership when `is_url_owned == true` (it reconstructs the Box
    // to free it). Hand the allocation off via `heap::alloc`.
    let href_box: Box<[u8]> = url_str.to_owned_slice().into_boxed_slice();
    let href_raw: *mut [u8] = bun_core::heap::into_raw(href_box);
    // SAFETY: `href_raw` is a freshly-leaked Box<[u8]>; we either pass ownership
    // to `preconnect` (which frees it) or reclaim it on the early-return paths.
    let href: &'static [u8] = unsafe { &*href_raw };
    let url = ZigURL::parse(href);

    macro_rules! reclaim_href {
        () => {
            // SAFETY: paired with the `heap::alloc` above; not yet handed to preconnect.
            drop(unsafe { bun_core::heap::take(href_raw) });
        };
    }

    if !url.is_http() && !url.is_https() && !url.is_s3() {
        reclaim_href!();
        return Err(
            global_object.throw_invalid_arguments(format_args!("URL must be HTTP or HTTPS"))
        );
    }

    if url.hostname.is_empty() {
        reclaim_href!();
        return Err(global_object
            .err(
                jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("{}", FETCH_ERROR_BLANK_URL),
            )
            .throw());
    }

    if !url.has_valid_port() {
        reclaim_href!();
        return Err(global_object.throw_invalid_arguments(format_args!("Invalid port")));
    }

    // `preconnect` is a free fn in `bun_http::async_http`. Ownership
    // of `href_raw` transfers here (`is_url_owned: true`).
    http::async_http::preconnect(url, true);
    Ok(JSValue::UNDEFINED)
}

// ──────────────────────────────────────────────────────────────────────────
// StringOrURL helper
// ──────────────────────────────────────────────────────────────────────────

struct StringOrURL;

impl StringOrURL {
    pub(crate) fn from_js(
        value: JSValue,
        global_this: &JSGlobalObject,
    ) -> JsResult<Option<BunString>> {
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
// Bun__fetch entry point
// ──────────────────────────────────────────────────────────────────────────

/// Public entry point for `Bun.fetch` - validates body on GET/HEAD/OPTIONS
#[bun_jsc::host_fn(export = "Bun__fetch")]
pub(crate) fn bun_fetch(ctx: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    reject_on_exception(ctx, fetch_impl::<false>(ctx, callframe))
}

/// WHATWG fetch step 3: an exception thrown while processing `input`/`init`
/// rejects the returned promise; `fetch()` never throws synchronously.
fn reject_on_exception(
    global_this: &JSGlobalObject,
    result: JsResult<JSValue>,
) -> JsResult<JSValue> {
    let err = match result {
        Ok(v) if !v.is_empty() => return Ok(v),
        Err(jsc::JsError::Terminated) => return Err(jsc::JsError::Terminated),
        Err(jsc::JsError::OutOfMemory) => global_this.create_out_of_memory_error(),
        Ok(_) | Err(jsc::JsError::Thrown) => match global_this.try_take_exception() {
            Some(exc) if exc.is_termination_exception() => return Err(jsc::JsError::Terminated),
            Some(exc) => exc.to_error().unwrap_or(exc),
            None => {
                // `fetch_impl` only returns Ok(ZERO)/Err(Thrown) with an exception
                // pending; reaching here means it was cleared, which is a bug.
                debug_assert!(
                    false,
                    "fetch_impl signaled a thrown exception but none is pending"
                );
                global_this.create_error_instance(format_args!("fetch() failed"))
            }
        },
    };
    Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(global_this, err))
}

// ──────────────────────────────────────────────────────────────────────────
// URLType
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
    let vm = VirtualMachine::get().as_mut();

    let mut upgraded_connection = false;
    let mut force_http2 = false;
    let mut force_http3 = false;
    let mut force_http1 = false;

    if arguments.len == 0 {
        let err = ctx.to_type_error(
            jsc::ErrorCode::MISSING_ARGS,
            format_args!("{FETCH_ERROR_NO_ARGS}"),
        );
        return Ok(
            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            ),
        );
    }

    let mut headers: Option<Headers> = None;

    // hoist the one `&mut vm` accessor before `args` takes an
    // immutable borrow of `vm` for the rest of the function.
    let vm_verbose_fetch = vm.get_verbose_fetch();

    let mut args = jsc::ArgumentsSlice::init(vm, arguments.slice());

    let first_arg = args.next_eat().unwrap();

    let mut disable_timeout = false;
    let mut idle_timeout_seconds: Option<core::ffi::c_uint> = None;
    let mut disable_keepalive = false;
    let mut disable_decompression = false;
    let mut compress: Option<compress_body::CompressOption> = None;
    let mut max_redirects: Option<u8> = None;
    let mut verbose: http::HTTPVerboseLevel = if vm
        .log_ref()
        .is_some_and(|l| l.level.at_least(bun_ast::Level::Debug))
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
    // AbortSignal is intrusive-refcounted; the +1 from `ref_()` is released by
    // `SignalRef`'s Drop on every early-return path, and disarmed via `take()`
    // when ownership is moved into `FetchOptions`.
    let mut signal = SignalRef(None);
    // Custom Hostname
    let mut hostname: Option<Box<[u8]>> = None;
    let mut range: Option<bun_core::ZBox> = None;
    let mut unix_socket_path: ZigStringSlice = ZigStringSlice::empty();

    // `url_proxy_buffer` gets reassigned while `url`/`proxy`
    // still point into it (or into the buffer about to replace it). Detach the
    // borrow-checker by parsing through a raw-pointer slice; the caller is
    // responsible for keeping the backing allocation alive (it always becomes
    // the new `url_proxy_buffer` before the old one is dropped).
    macro_rules! parse_url_detached {
        ($slice:expr) => {{
            let s: &[u8] = $slice;
            // SAFETY: `s` points into a Vec that is immediately adopted as
            // `url_proxy_buffer` (or already is it); see note above.
            ZigURL::parse(unsafe { bun_ptr::detach_lifetime(s) })
        }};
    }
    let mut url_type = URLType::Remote;

    let mut ssl_config: Option<http::ssl_config::SharedPtr> = None;
    let mut reject_unauthorized = vm.get_tls_reject_unauthorized();
    let mut check_server_identity: JSValue = JSValue::ZERO;

    // signal/unix_socket_path/url_proxy_buffer/headers/body/hostname/range/
    // ssl_config are all owning types whose Drop runs on early return
    // (`signal` via `SignalRef`).

    let options_object: Option<JSValue> = 'brk: {
        if let Some(options) = args.next_eat() {
            let options: JSValue = options;
            if options.is_object() || options.js_type() == jsc::JSType::DOMWrapper {
                break 'brk Some(options);
            }
        }
        break 'brk None;
    };

    // kept as raw `*mut Request` because the body re-borrows it
    // multiple times across long-lived option/init reads.
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

    // Every arm carries a +1 (`from_js`/`dupe_ref`/`StringOrURL::from_js`).
    // `bun_core::String` is `Copy`
    // with NO `Drop`, so wrap in `OwnedString` for the scope-exit deref —
    // without it the +1 leaks the WTFStringImpl, and when the input JS string
    // is a substring sharing an `ExternalStringImpl` (e.g. a slice of a
    // `TextDecoder.decode()` result), that leaked +1 transitively pins the
    // external buffer past `~VM`.
    let url_str: bun_core::OwnedString = bun_core::OwnedString::new('extract_url: {
        if let Some(str) = url_str_optional {
            break 'extract_url str;
        }

        if let Some(req) = request_mut!() {
            let _ = req.ensure_url(); // bun.handleOom — aborts on OOM
            break 'extract_url req.url.get().dupe_ref();
        }

        if let Some(request_init) = request_init_object {
            if let Some(url_) = request_init.fast_get(global_this, jsc::BuiltinName::Url)? {
                if !url_.is_undefined() {
                    break 'extract_url BunString::from_js(url_, global_this)?;
                }
            }
        }

        break 'extract_url BunString::empty();
    });

    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    if url_str.is_empty() {
        let err = ctx.to_type_error(
            jsc::ErrorCode::INVALID_URL,
            format_args!("{FETCH_ERROR_BLANK_URL}"),
        );
        return Ok(
            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            ),
        );
    }

    if url_str.has_prefix_comptime(b"data:") {
        let url_slice = url_str.to_utf8_without_ref();
        // `defer url_slice.deinit()` → Drop.

        let data_url = match DataURL::parse_without_check(url_slice.slice()) {
            Ok(d) => d,
            Err(_) => {
                let err = ctx.create_error_instance(format_args!("failed to fetch the data URL"));
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        err,
                    ),
                );
            }
        };
        let mut data_url = data_url;
        // `data_url_response` `dupe_ref()`s this, so pass a borrowed view (no
        // extra ref); `url_str`'s scope-exit deref balances it.
        data_url.url = url_str.get();
        return Ok(data_url_response(data_url, global_this));
    }

    // `ZigURL::from_string` returns `OwnedURL` (owns href buffer); we
    // immediately move that buffer into `url_proxy_buffer` and re-parse `url` to
    // borrow it.
    let owned_url = match ZigURL::from_string(&url_str) {
        Ok(u) => u,
        Err(_) => {
            let err = ctx.to_type_error(
                jsc::ErrorCode::INVALID_URL,
                format_args!("fetch() URL is invalid"),
            );
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    err,
                ),
            );
        }
    };
    let mut url_proxy_buffer = owned_url.into_href().into_vec();
    let mut url = parse_url_detached!(&url_proxy_buffer[..]);
    if url.is_file() {
        url_type = URLType::File;
    } else if url.is_blob() {
        url_type = URLType::Blob;
    }

    // **Start with the harmless ones.**

    // "method"
    let mut method = 'extract_method: {
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
                    return Ok(JSValue::ZERO);
                }
            }
        }

        break 'extract_disable_decompression disable_decompression;
    };

    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    // "compress: boolean | string | { encoding, level? }"
    'extract_compress: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(compress_value) = obj.get(global_this, "compress")? {
                    if !compress_value.is_undefined() {
                        compress = compress_body::from_js(global_this, compress_value)?;
                        break 'extract_compress;
                    }
                }

                if global_this.has_exception() {
                    return Ok(JSValue::ZERO);
                }
            }
        }
    }

    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    // "maxRedirects: number"
    'extract_max_redirects: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(value) = obj.get(global_this, "maxRedirects")? {
                    if !value.is_undefined_or_null() {
                        if !value.is_number() {
                            return Err(global_this.throw_invalid_arguments(format_args!(
                                "fetch: 'maxRedirects' must be a non-negative integer"
                            )));
                        }
                        let n = value.as_number();
                        if n.is_nan() || n < 0.0 || n.fract() != 0.0 {
                            return Err(global_this.throw_invalid_arguments(format_args!(
                                "fetch: 'maxRedirects' must be a non-negative integer"
                            )));
                        }
                        max_redirects = Some(n.min(126.0) as u8);
                        break 'extract_max_redirects;
                    }
                }

                if global_this.has_exception() {
                    return Ok(JSValue::ZERO);
                }
            }
        }
    }

    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    // "tls: TLSConfig"
    ssl_config = 'extract_ssl_config: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

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
                            return Ok(JSValue::ZERO);
                        }

                        if let Some(check_server_identity_) = tls.get(ctx, "checkServerIdentity")? {
                            if check_server_identity_.is_cell()
                                && check_server_identity_.is_callable()
                            {
                                check_server_identity = check_server_identity_;
                            }
                        }

                        if global_this.has_exception() {
                            return Ok(JSValue::ZERO);
                        }

                        match SSLConfig::from_js(vm, global_this, tls) {
                            Err(_) => {
                                return Ok(JSValue::ZERO);
                            }
                            Ok(Some(config)) => {
                                // Intern via GlobalRegistry for deduplication and pointer equality
                                break 'extract_ssl_config Some(ssl_config_intern_for_http(config));
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
        return Ok(JSValue::ZERO);
    }

    // unix: string | undefined
    unix_socket_path = 'extract_unix_socket_path: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(socket_path) = obj.get(global_this, "unix")? {
                    if socket_path.is_string() && socket_path.get_length(ctx)? > 0 {
                        break 'extract_unix_socket_path socket_path.to_slice_clone(global_this)?;
                    }
                }

                if global_this.has_exception() {
                    return Ok(JSValue::ZERO);
                }
            }
        }
        break 'extract_unix_socket_path unix_socket_path;
    };

    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    // protocol: "http2" | "h2" | "http1.1" | "h1" | undefined.
    'extract_protocol: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];
        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(protocol_val) = obj.get(global_this, "protocol")? {
                    if protocol_val.is_string() {
                        let str =
                            bun_core::OwnedString::new(protocol_val.to_bun_string(global_this)?);
                        if str.eql_comptime(b"http2") || str.eql_comptime(b"h2") {
                            force_http2 = true;
                        } else if str.eql_comptime(b"http3") || str.eql_comptime(b"h3") {
                            force_http3 = true;
                        } else if str.eql_comptime(b"http1.1") || str.eql_comptime(b"h1") {
                            force_http1 = true;
                        } else {
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

        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(timeout_value) = obj.get(global_this, "timeout")? {
                    if timeout_value.is_boolean() {
                        break 'extract_disable_timeout !timeout_value.as_boolean();
                    } else if timeout_value.is_number() {
                        // A finite positive `timeout` (in ms) also governs the
                        // socket idle deadline, overriding the global
                        // `BUN_CONFIG_HTTP_IDLE_TIMEOUT` default.
                        let ms = timeout_value.as_number();
                        if ms.is_finite() && ms > 0.0 {
                            idle_timeout_seconds =
                                Some((ms / 1000.0).ceil().min(core::ffi::c_uint::MAX as f64)
                                    as core::ffi::c_uint);
                        }
                        // `to_int32()` saturates ±Infinity (JSC's
                        // `coerceJSValueDoubleTruncatingT`, not spec ToInt32),
                        // so gate on `is_finite()` too so `{timeout: Infinity}`
                        // disables the timer instead of silently falling back
                        // to the global default.
                        break 'extract_disable_timeout !ms.is_finite()
                            || timeout_value.to_int32() == 0;
                    }
                }

                if global_this.has_exception() {
                    return Ok(JSValue::ZERO);
                }
            }
        }

        break 'extract_disable_timeout disable_timeout;
    };

    if global_this.has_exception() {
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

        for obj in objects_to_try {
            if !obj.is_empty() {
                match obj.get_optional_enum::<FetchRedirect>(global_this, "redirect") {
                    Err(_) => {
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
        return Ok(JSValue::ZERO);
    }

    // keepalive: boolean | undefined;
    disable_keepalive = 'extract_disable_keepalive: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

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
                    return Ok(JSValue::ZERO);
                }
            }
        }

        break 'extract_disable_keepalive disable_keepalive;
    };

    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    // verbose: boolean | "curl" | undefined;
    verbose = 'extract_verbose: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];

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
                    return Ok(JSValue::ZERO);
                }
            }
        }
        break 'extract_verbose verbose;
    };

    // proxy: string | { url: string, headers?: Headers } | undefined;
    let mut proxy_headers: Option<Headers> = None;
    // `defer if (proxy_headers) |*hdrs| hdrs.deinit();` → Headers impls Drop.
    url_proxy_buffer = 'extract_proxy: {
        let objects_to_try = [
            options_object.unwrap_or(JSValue::ZERO),
            request_init_object.unwrap_or(JSValue::ZERO),
        ];
        for obj in objects_to_try {
            if !obj.is_empty() {
                if let Some(proxy_arg) = obj.get(global_this, "proxy")? {
                    if proxy_arg.is_string() && proxy_arg.get_length(ctx)? == 0 {
                        // proxy: "" is an explicit direct connection (skip the
                        // ambient HTTP_PROXY env fallback); FetchTasklet already
                        // maps Some(empty) → direct, this makes it reachable.
                        proxy = Some(ZigURL::default());
                        break 'extract_proxy url_proxy_buffer;
                    }
                    // A URL instance has no `.url` own property, so the `{url, headers}`
                    // branch below would silently ignore it. Treat it as its href here.
                    let is_url_instance =
                        bun_jsc::DOMURL::cast_(proxy_arg, global_this.vm()).is_some();
                    // Handle string format: proxy: "http://proxy.example.com:8080"
                    if is_url_instance || (proxy_arg.is_string() && proxy_arg.get_length(ctx)? > 0)
                    {
                        // `href_from_js` returns a +1 WTFStringImpl ref; `bun_core::String`
                        // is `Copy` with no `Drop`, so wrap in `OwnedString` for scope-exit
                        // deref (mirrors `defer href.deref()` in fetch.zig).
                        let href = bun_core::OwnedString::new(jsc::URL::href_from_js(
                            proxy_arg,
                            global_this,
                        )?);
                        if href.tag() == BunStringTag::Dead {
                            let err = ctx.to_type_error(
                                jsc::ErrorCode::INVALID_ARG_VALUE,
                                format_args!("fetch() proxy URL is invalid"),
                            );
                            return Ok(
                                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                    global_this, err,
                                ),
                            );
                        }
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
                        // allocator.free(url_proxy_buffer) — old Vec dropped on reassign.
                        break 'extract_proxy buffer;
                    }
                    // Handle object format: proxy: { url: "http://proxy.example.com:8080", headers?: Headers }
                    // If the proxy object doesn't have a 'url' property, ignore it.
                    if proxy_arg.is_object() {
                        // Get the URL from the proxy object
                        if let Some(proxy_url_arg) = proxy_arg.get(global_this, "url")? {
                            if !proxy_url_arg.is_undefined_or_null() {
                                // Deliberately no type gate: `href_from_js` accepts a string
                                // or a `URL` object and is the sole validator (Dead = invalid).
                                // +1 ref; see the string-format branch above.
                                let href = bun_core::OwnedString::new(jsc::URL::href_from_js(
                                    proxy_url_arg,
                                    global_this,
                                )?);
                                if href.tag() == BunStringTag::Dead {
                                    let err = ctx.to_type_error(
                                        jsc::ErrorCode::INVALID_ARG_VALUE,
                                        format_args!("fetch() proxy URL is invalid"),
                                    );
                                    return Ok(
                                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                            global_this, err,
                                        ),
                                    );
                                }
                                let mut buffer: Vec<u8> =
                                    Vec::with_capacity(url_proxy_buffer.len());
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
                                // allocator.free(url_proxy_buffer) — old Vec dropped on reassign.
                                url_proxy_buffer = buffer;

                                // Get the headers from the proxy object (optional)
                                if let Some(headers_value) =
                                    proxy_arg.get(global_this, "headers")?
                                {
                                    if !headers_value.is_undefined_or_null() {
                                        if let Some(fetch_hdrs) = FetchHeaders::cast(headers_value)
                                        {
                                            // `cast` returns a live JS-owned FetchHeaders*;
                                            // BackRef invariant holds for this read.
                                            let fetch_hdrs = bun_ptr::BackRef::from(fetch_hdrs);
                                            proxy_headers =
                                                Some(from_fetch_headers(Some(&*fetch_hdrs), None));
                                        } else if let Some(fetch_hdrs) =
                                            FetchHeaders::create_from_js(ctx, headers_value)?
                                        {
                                            // `create_from_js` returns a +1-ref NonNull<FetchHeaders>;
                                            // RAII guard releases it on scope exit.
                                            let _guard = FetchHeadersRef(Some(fetch_hdrs));
                                            let fetch_hdrs = bun_ptr::BackRef::from(fetch_hdrs);
                                            proxy_headers =
                                                Some(from_fetch_headers(Some(&*fetch_hdrs), None));
                                        }
                                    }
                                }

                                break 'extract_proxy url_proxy_buffer;
                            }
                        }
                    }
                }

                if global_this.has_exception() {
                    return Ok(JSValue::ZERO);
                }
            }
        }

        break 'extract_proxy url_proxy_buffer;
    };

    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    // signal: AbortSignal | null | undefined;
    // WebIDL `AbortSignal?` member: present iff not undefined. A present `null`
    // detaches (no fallback to the input Request's signal); a present non-null
    // non-AbortSignal is a TypeError.
    signal.0 = 'extract_signal: {
        if let Some(options) = options_object {
            if let Some(signal_) = options.get(global_this, "signal")? {
                if signal_.is_null() {
                    break 'extract_signal None;
                }
                if let Some(signal__) = AbortSignal::from_js(signal_) {
                    // `AbortSignal` is an opaque ZST FFI handle (S008) — safe
                    // `*mut → &` via `opaque_deref`; `ref_` bumps refcount.
                    break 'extract_signal NonNull::new(bun_opaque::opaque_deref(signal__).ref_());
                }
                let err = ctx.to_type_error(
                    jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("signal is not of type AbortSignal."),
                );
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        err,
                    ),
                );
            }

            if global_this.has_exception() {
                return Ok(JSValue::ZERO);
            }
        }

        if let Some(req) = request_mut!() {
            if let Some(signal_) = req.signal.get() {
                break 'extract_signal NonNull::new(signal_.ref_());
            }
            break 'extract_signal None;
        }

        if let Some(options) = request_init_object {
            if let Some(signal_) = options.get(global_this, "signal")? {
                if signal_.is_null() {
                    break 'extract_signal None;
                }
                if let Some(signal__) = AbortSignal::from_js(signal_) {
                    // `AbortSignal` is an opaque ZST FFI handle (S008) — safe
                    // `*mut → &` via `opaque_deref`; `ref_` bumps refcount.
                    break 'extract_signal NonNull::new(bun_opaque::opaque_deref(signal__).ref_());
                }
                let err = ctx.to_type_error(
                    jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("signal is not of type AbortSignal."),
                );
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        err,
                    ),
                );
            }
        }

        break 'extract_signal None;
    };

    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    // We do this 2nd to last instead of last so that if it's a FormData
    // object, we can still insert the boundary.
    //
    // We must always get the Body before the Headers That way, we can set
    // the Content-Type header from the Blob if no Content-Type header is
    // set in the Headers
    //
    // which is important for FormData.
    // https://github.com/oven-sh/bun/issues/2264
    //
    // body: BodyInit | null | undefined;
    //
    let mut body = 'extract_body: {
        if let Some(options) = options_object {
            if let Some(body__) = options.fast_get(global_this, jsc::BuiltinName::Body)? {
                if !body__.is_undefined() {
                    break 'extract_body Some(HTTPRequestBody::from_js(ctx, body__)?);
                }
            }

            if global_this.has_exception() {
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
                    .err(
                        jsc::ErrorCode::BODY_ALREADY_USED,
                        format_args!("Request body already used"),
                    )
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

            break 'extract_body Some(HTTPRequestBody::AnyBlob(
                req.get_body_value().use_as_any_blob(),
            ));
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
        return Ok(JSValue::ZERO);
    }

    // headers: Headers | undefined;
    headers = 'extract_headers: {
        // Releases the +1 from `create_from_js` on every exit path (including
        // the `has_exception()` early returns below).
        let mut fetch_headers_to_deref = FetchHeadersRef(None);

        let fetch_headers: Option<*mut FetchHeaders> = 'brk: {
            if let Some(options) = options_object {
                if let Some(headers_value) =
                    options.fast_get(global_this, jsc::BuiltinName::Headers)?
                {
                    if !headers_value.is_undefined() {
                        if let Some(headers__) = FetchHeaders::cast(headers_value) {
                            // `FetchHeaders` is an opaque ZST FFI handle (S008) — safe deref.
                            if bun_opaque::opaque_deref_mut(headers__.as_ptr()).is_empty() {
                                break 'brk None;
                            }
                            break 'brk Some(headers__.as_ptr());
                        }

                        if let Some(headers__) = FetchHeaders::create_from_js(ctx, headers_value)? {
                            fetch_headers_to_deref.0 = Some(headers__);
                            break 'brk Some(headers__.as_ptr());
                        }

                        break 'brk None;
                    }
                }

                if global_this.has_exception() {
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
                            // `FetchHeaders` is an opaque ZST FFI handle (S008) — safe deref.
                            if bun_opaque::opaque_deref_mut(headers__.as_ptr()).is_empty() {
                                break 'brk None;
                            }
                            break 'brk Some(headers__.as_ptr());
                        }

                        if let Some(headers__) = FetchHeaders::create_from_js(ctx, headers_value)? {
                            fetch_headers_to_deref.0 = Some(headers__);
                            break 'brk Some(headers__.as_ptr());
                        }

                        break 'brk None;
                    }
                }
            }

            if global_this.has_exception() {
                return Ok(JSValue::ZERO);
            }

            break 'extract_headers headers;
        };

        if global_this.has_exception() {
            return Ok(JSValue::ZERO);
        }

        let result = if let Some(headers_) = fetch_headers {
            // `headers_` points to a live FetchHeaders (either JS-owned or
            // refcounted via `fetch_headers_to_deref` above). `FetchHeaders` is
            // an opaque ZST FFI handle (S008) — safe `*mut → &mut` deref.
            let headers_ref = bun_opaque::opaque_deref_mut(headers_);
            if let Some(hostname_) = headers_ref.fast_get(HTTPHeaderName::Host) {
                hostname = Some(hostname_.to_owned_slice().into_boxed_slice());
            }
            if url.is_s3() {
                if let Some(range_) = headers_ref.fast_get(HTTPHeaderName::Range) {
                    range = Some(range_.to_owned_slice_z());
                }
            }

            if let Some(upgrade_) = headers_ref.fast_get(HTTPHeaderName::Upgrade) {
                let upgrade = upgrade_.to_slice();
                // `defer upgrade.deinit()` → Drop.
                let slice = upgrade.slice();
                if slice != b"h2" && slice != b"h2c" {
                    upgraded_connection = true;
                }
            }

            Some(from_fetch_headers(
                Some(headers_ref),
                any_blob_content_type_opt(body.get_any_blob().map(|b| &*b)),
            ))
        } else {
            headers
        };

        // `fetch_headers_to_deref` Drop releases the +1 from create_from_js.
        break 'extract_headers result;
    };

    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    if proxy.is_some() && !unix_socket_path.slice().is_empty() {
        let err = ctx.to_type_error(
            jsc::ErrorCode::INVALID_ARG_VALUE,
            format_args!("{FETCH_ERROR_PROXY_UNIX}"),
        );
        return Ok(
            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            ),
        );
    }

    if global_this.has_exception() {
        return Ok(JSValue::ZERO);
    }

    // This is not 100% correct.
    // We don't pass along headers, we ignore method, we ignore status code...
    // But it's better than status quo.
    if url_type != URLType::Remote {
        // `defer unix_socket_path.deinit()` → Drop on scope exit.
        let mut path_buf = PathBuffer::uninit();
        let mut path_buf2 = PathBuffer::uninit();
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
                return Err(
                    global_this.throw_error(bun_url::Error::from(err), "Failed to decode file url")
                );
            }
        };
        let url_path_decoded = &path_buf2[0..decoded_len as usize];

        // Carries a +1 WTFStringImpl ref on both assignment arms (`create_format`
        // for blob:, `file_url_from_string` → `Bun::toStringRef` for file:).
        // `Response::init` wraps it in `OwnedString` and adopts that +1, so it
        // is passed by value below without an extra `.clone()`.
        let url_string: BunString;

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
                    let err = global_this.to_type_error(
                        jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!(
                            "Failed to resolve blob:{}",
                            bstr::BStr::new(url_path_decoded)
                        ),
                    );
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
                        let url_path_decoded = if url_path_decoded[0] == b'/' {
                            &url_path_decoded[1..]
                        } else {
                            url_path_decoded
                        };
                        break 'brk match PosixToWinNormalizer::resolve_cwd_with_external_buf_z(
                            &mut path_buf,
                            url_path_decoded,
                        ) {
                            Ok(p) => p,
                            Err(err) => {
                                return Err(
                                    global_this.throw_error(err, "Failed to resolve file url")
                                );
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
                // `bun_sys::getcwd` returns the byte length written into
                // `cwd_buf`; slice it here.
                let cwd: &[u8] = match bun_sys::getcwd(&mut cwd_buf) {
                    Ok(len) => &cwd_buf[..len],
                    Err(err) => {
                        return Err(global_this.throw_error(err, "Failed to resolve file url"));
                    }
                };
                #[cfg(not(windows))]
                let cwd = bun_resolver::fs::FileSystem::get().top_level_dir;

                // SAFETY: bun_vm() returns the live thread-local VM pointer.
                let main = global_this.bun_vm().as_mut().main();
                let fullpath = bun_paths::resolve_path::join_abs_string_buf::<
                    bun_paths::platform::Auto,
                >(
                    cwd, &mut path_buf, &[main, b"../", url_path_decoded]
                );
                #[cfg(windows)]
                {
                    break 'brk match PosixToWinNormalizer::resolve_cwd_with_external_buf_z(
                        &mut path_buf2,
                        fullpath,
                    ) {
                        Ok(p) => p,
                        Err(err) => {
                            return Err(global_this.throw_error(err, "Failed to resolve file url"));
                        }
                    };
                }
                #[cfg(not(windows))]
                {
                    break 'brk fullpath;
                }
            };

            url_string = jsc::URL::file_url_from_string(BunString::borrow_utf8(temp_file_path));

            // `find_or_create_file_from_path` is typed against the
            // `crate::webcore::node_types` stub (until it's swapped to a
            // re-export of `crate::node::types`); construct that variant here.
            let mut pathlike = crate::webcore::node_types::PathOrFileDescriptor::Path(
                crate::webcore::node_types::PathLike::EncodedSlice(ZigStringSlice::init_owned(
                    temp_file_path.to_vec(),
                )),
            );

            break 'blob Blob::find_or_create_file_from_path(&mut pathlike, global_this, true);
        };

        let response = bun_core::heap::into_raw(Box::new(Response::init(
            response::Init {
                status_code: 200,
                ..Default::default()
            },
            Body::new(BodyValue::Blob(blob_to_use)),
            url_string,
            false,
        )));

        // Ownership of the boxed Response transfers to the JS GC; see
        // `data_url_response` for the rationale.
        return Ok(JSPromise::resolved_promise_value(
            global_this,
            // SAFETY: `response` is a freshly allocated heap `Response`; ownership
            // transfers to JSC.
            Response::make_maybe_pooled(global_this, response),
        ));
    }

    if !url.protocol.is_empty() {
        if !(url.is_http() || url.is_https() || url.is_s3()) {
            let err = global_this.to_type_error(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!("protocol must be http:, https: or s3:"),
            );
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
            format_args!("{FETCH_ERROR_UNEXPECTED_BODY}"),
        );
        return Ok(
            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            ),
        );
    }

    // Fetch spec step 11: reject synchronously for a pre-aborted signal. Runs
    // after body/header extraction so Request-constructor errors (GET+body,
    // already-used body) win and `request.bodyUsed` is set, matching Node.
    if let Some(sig) = signal.0 {
        let sig = bun_ptr::BackRef::from(sig);
        if sig.aborted() {
            // `abort_reason()` is the stored `m_reason` (same object as
            // `signal.reason`), not a reconstructed DOMException.
            let reason = sig.abort_reason();
            if let HTTPRequestBody::ReadableStream(stream_ref) = &body {
                if let Some(stream) = stream_ref.get(global_this) {
                    stream.cancel_with_reason(global_this, reason);
                }
            }
            body.detach();
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    reason,
                ),
            );
        }
    }

    if headers.is_none() && body.has_body() && body.has_content_type_from_user() {
        headers = Some(from_fetch_headers(
            None,
            any_blob_content_type_opt(body.get_any_blob().map(|b| &*b)),
        ));
    }

    // `body` is mutated in place for the sendfile/readfile paths and then
    // *moved* into `FetchOptions`.

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
                let mut old = core::mem::replace(
                    &mut body,
                    HTTPRequestBody::ReadableStream(readable_stream::Strong::init(
                        stream,
                        global_this,
                    )),
                );
                // HTTPRequestBody has no Drop
                // impl, so a bare `drop(old)` would leak the S3 Blob.Store ref.
                old.detach();
                break 'prepare_body;
            }
            let rejected_value =
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    global_this.create_error_instance(format_args!("Failed to start s3 stream")),
                );
            // HTTPRequestBody has no Drop impl, so a bare `drop(body)` would
            // leak the S3 Blob.Store ref.
            body.detach();
            return Ok(rejected_value);
        }
    }
    if body.needs_to_read_file() {
        'prepare_body: {
            // A local `PathBuffer` serves as NUL-termination scratch for
            // `path.slice_z()` (the `vm.node_fs()` accessor is gated behind a
            // jsc↔runtime cycle).
            let mut open_path_buf = PathBuffer::uninit();
            let opened_fd_res: bun_sys::Result<bun_sys::Fd> = {
                let store = body.store().expect("needs_to_read_file implies store");
                match &store.data.as_file().pathlike {
                    PathOrFileDescriptor::Fd(fd) => bun_sys::dup(*fd),
                    PathOrFileDescriptor::Path(path) => {
                        let zpath = path.slice_z(&mut open_path_buf);
                        let flags = if cfg!(windows) {
                            bun_sys::O::RDONLY
                        } else {
                            bun_sys::O::RDONLY | bun_sys::O::NOCTTY
                        };
                        bun_sys::open(zpath, flags, 0)
                    }
                }
            };

            let opened_fd = match opened_fd_res {
                Err(err) => {
                    let err_js = err.to_js(global_this);
                    let rejected_value =
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err_js,
                        );
                    return Ok(rejected_value);
                }
                Ok(fd) => fd,
            };

            // An explicit `compress` request always wins over the sendfile
            // heuristic — otherwise the same `Bun.file()` body would compress
            // over https/proxy/<32 KiB/Windows but silently not over plain http.
            if proxy.is_none() && compress.is_none() && http::SendFile::is_eligible(&url) {
                'use_sendfile: {
                    let stat: bun_sys::Stat = match bun_sys::fstat(opened_fd) {
                        Ok(result) => result,
                        // bail out for any reason
                        Err(_) => break 'use_sendfile,
                    };

                    #[cfg(target_os = "macos")]
                    {
                        // macOS only supports regular files for sendfile()
                        if !bun_sys::S::ISREG(stat.st_mode as u32) {
                            break 'use_sendfile;
                        }
                    }

                    // if it's < 32 KB, it's not worth it
                    if stat.st_size < 32 * 1024 {
                        break 'use_sendfile;
                    }

                    let original_size = body.any_blob().blob().size.get();
                    let stat_size = blob::SizeType::try_from(stat.st_size).expect("int cast");
                    let blob_size = if bun_sys::S::ISREG(stat.st_mode as u32) {
                        stat_size
                    } else {
                        original_size.min(stat_size)
                    };
                    let blob_offset = body.any_blob().blob().offset.get();

                    // `http::SendFile` fields are `usize`; blob sizes/offsets
                    // are `blob::SizeType` (u64) — hence the `as usize` casts.
                    let mut sf = http::SendFile {
                        fd: opened_fd,
                        remain: (blob_offset + original_size) as usize,
                        offset: blob_offset as usize,
                        content_size: blob_size as usize,
                    };

                    if bun_sys::S::ISREG(stat.st_mode as u32) {
                        let stat_size_usize = stat_size as usize;
                        sf.offset = sf.offset.min(stat_size_usize);
                        sf.remain = sf
                            .remain
                            .max(sf.offset)
                            .min(stat_size_usize)
                            .saturating_sub(sf.offset);
                    }
                    body.detach();
                    body = HTTPRequestBody::Sendfile(sf);

                    break 'prepare_body;
                }
            }

            // The sendfile path above moves `opened_fd` into `SendFile` (which
            // owns its lifecycle and breaks out of `'prepare_body`). On this
            // read-file path we are the sole owner of the fresh fd: `read_file`
            // is handed it as an `Fd` and never takes ownership. Wrap it in an
            // RAII guard so any future early return between here and the read
            // can't leak it.
            let opened_fd = scopeguard::guard(opened_fd, |fd| fd.close());

            // TODO: make this async + lazy
            let blob_offset = body.any_blob().blob().offset.get();
            let blob_size = body.any_blob().blob().size.get();
            // The `vm.node_fs()` accessor is a jsc↔runtime cycle. `read_file`
            // with an `Fd` path only touches `self.sync_error_buf` for
            // path-variant inputs, so a fresh `NodeFS` is sufficient here.
            let mut node_fs = node::fs::NodeFS::default();
            // `ReadFile` has `Drop`; can't use FRU `..Default::default()`.
            let mut rf_args = node::fs::args::ReadFile::default();
            rf_args.encoding = Encoding::Buffer;
            rf_args.path = PathOrFileDescriptor::Fd(*opened_fd);
            rf_args.offset = blob_offset;
            rf_args.max_size = Some(blob_size);
            let res = node_fs.read_file(&rf_args, node::fs::Flavor::Sync);

            // Eagerly close before constructing the (potentially large) JS
            // result. Dropping the guard runs the close exactly once.
            drop(opened_fd);

            match res {
                Err(err) => {
                    let rejected_value =
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err.to_js(global_this),
                        );
                    body.detach();
                    return Ok(rejected_value);
                }
                Ok(mut result) => {
                    body.detach();
                    body = HTTPRequestBody::AnyBlob(blob::Any::from_owned_slice(
                        result.slice().to_vec(),
                    ));
                    // StringOrBuffer::Drop is a no-op for Buffer; release the
                    // readFile allocation now that the bytes are copied out.
                    if let crate::node::types::StringOrBuffer::Buffer(buf) = &mut result {
                        buf.destroy();
                    }
                }
            }
        }
    }

    // Automatic request-body compression. Only buffered bodies (Blob bytes,
    // ArrayBuffer/TypedArray, string) are handled; ReadableStream and sendfile
    // are skipped. S3 destinations replace the header set with a signed one,
    // so compression is skipped there too. The actual compression runs on the
    // HTTP thread (HTTPClient::start) so it can reuse LibdeflateState's shared
    // scratch buffer; here we only commit to it by appending Content-Encoding
    // and forwarding the option.
    if let Some(compress_opt) = &compress
        && let HTTPRequestBody::AnyBlob(_) = &body
        && !url.is_s3()
    {
        let already_has_encoding = headers
            .as_ref()
            .and_then(|h| h.get_content_encoding())
            .is_some();
        if !already_has_encoding && !body.slice().is_empty() {
            headers
                .get_or_insert_default()
                .append(b"Content-Encoding", compress_opt.encoding.header_value());
        } else {
            compress = None;
        }
    } else {
        compress = None;
    }

    if url.is_s3() {
        // get ENV config — `Transpiler::env_mut` is the safe accessor for the
        // process-singleton dotenv loader (set during init).
        let env_creds = s3_credentials_from_env(
            global_this
                .bun_vm()
                .as_mut()
                .transpiler
                .env_mut()
                .get_s3_credentials(),
        );
        let mut credentials_with_options = s3::S3CredentialsWithOptions {
            credentials: env_creds,
            options: Default::default(),
            acl: None,
            storage_class: None,
            ..Default::default()
        };
        // `defer credentialsWithOptions.deinit()` → Drop.

        if let Some(options) = options_object {
            if let Some(s3_options) = options.get_truthy(global_this, "s3")? {
                let s3_options: JSValue = s3_options;
                if s3_options.is_object() {
                    s3_options.ensure_still_alive();
                    use crate::webcore::s3_client::S3CredentialsExt as _;
                    credentials_with_options = <s3::S3Credentials>::get_credentials_with_options(
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
            // `defer body.ReadableStream.deinit()` → Drop on `body` scope exit.

            if method != Method::PUT && method != Method::POST {
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        global_this.create_error_instance(format_args!(
                            "Only POST and PUT do support body when using S3"
                        )),
                    ),
                );
            }
            let promise = jsc::JSPromiseStrong::init(global_this);
            let promise_value = promise.value();

            // `S3StreamWrapper.url` borrows `url_proxy_buffer`; box
            // the buffer first (stable heap address) and re-parse so the
            // detached-lifetime slices remain valid after the Vec → Box move.
            let owned_buffer: Box<[u8]> = core::mem::take(&mut url_proxy_buffer).into_boxed_slice();
            let url_len = url.href.len();
            // SAFETY: `owned_buffer` is moved into `s3_stream` alongside the
            // re-parsed URL; the slices stay valid for the buffer's lifetime.
            let url_static =
                ZigURL::parse(unsafe { bun_ptr::detach_lifetime(&owned_buffer[..url_len]) });
            let s3_path = url_static.s3_path();

            // Proxy href (if any) lives in the same buffer, immediately after `url`.
            let proxy_url: Option<&[u8]> = if proxy.is_some() {
                // SAFETY: see `url_static` SAFETY note above.
                Some(unsafe { bun_ptr::detach_lifetime(&owned_buffer[url_len..]) })
            } else {
                None
            };

            let s3_stream = Box::new(S3StreamWrapper {
                url: url_static,
                _url_proxy_buffer: owned_buffer,
                promise,
                global: global_this,
            });
            // Shim: erases both the payload type and the `Result` return when
            // coercing to the `fn (S3UploadResult, *mut c_void)` callback shape.
            fn s3_stream_wrapper_resolve(result: s3::S3UploadResult<'_>, ctx: *mut libc::c_void) {
                // SAFETY: ctx was produced by `heap::alloc(s3_stream)` below; the
                // 'static lifetime is a raw-pointer fiction (the pointee's real
                // lifetime is managed by the resolve callback itself).
                let _ = S3StreamWrapper::resolve(result, ctx.cast::<S3StreamWrapper<'static>>());
            }
            // `dupe()` heap-allocates a fresh intrusive-refcounted copy.
            // `upload_stream` adopts the ref by value (no extra bump) and the
            // MultiPartUpload derefs on completion.
            let _ = s3::upload_stream(
                credentials_with_options.credentials.dupe(),
                s3_path,
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
                bun_core::heap::into_raw(s3_stream).cast::<libc::c_void>(),
            )?;
            // url/url_proxy_buffer ownership moved into s3_stream above.
            return Ok(promise_value);
        }
        if method == Method::POST {
            method = Method::PUT;
        }

        let mut result = match credentials_with_options.credentials.sign_request::<false>(
            &SignOptions {
                path: url.s3_path(),
                method,
                ..Default::default()
            },
            None,
        ) {
            Ok(r) => r,
            Err(sign_err) => {
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        s3::get_js_sign_error(sign_err.into(), global_this),
                    ),
                );
            }
        };
        // `defer result.deinit()` → Drop.

        if let Some(proxy_) = &proxy {
            // proxy and url are in the same buffer lets replace it
            let old_buffer = core::mem::take(&mut url_proxy_buffer);
            // `defer allocator.free(old_buffer)` → drop(old_buffer) at end of scope.
            let mut buffer = vec![0u8; result.url.len() + proxy_.href.len()];
            buffer[0..result.url.len()].copy_from_slice(&result.url);
            buffer[result.url.len()..].copy_from_slice(proxy_.href);
            url_proxy_buffer = buffer;

            url = parse_url_detached!(&url_proxy_buffer[0..result.url.len()]);
            proxy = Some(parse_url_detached!(&url_proxy_buffer[result.url.len()..]));
            drop(old_buffer);
        } else {
            // replace headers and url of the request
            // allocator.free(url_proxy_buffer) — old Vec dropped on reassign.
            url_proxy_buffer = core::mem::take(&mut result.url).into();
            url = parse_url_detached!(&url_proxy_buffer[..]);
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

    // `FetchOptions.{url,proxy}` are `ZigURL<'static>` borrowing the
    // `url_proxy_buffer: Box<[u8]>` stored alongside them — a self-referential
    // struct. `Vec::into_boxed_slice` may realloc when `cap > len` (the
    // proxy-string path above triggers this), so the existing `url`/`proxy`
    // slices may dangle after the conversion. Convert to `Box<[u8]>` first
    // (stable heap address), then re-parse the URLs from the boxed buffer.
    let url_len = url.href.len(); // fat-pointer len read; no deref
    let has_proxy = proxy.is_some();
    let url_proxy_boxed: Box<[u8]> = core::mem::take(&mut url_proxy_buffer).into_boxed_slice();
    // SAFETY: `url_proxy_boxed` is moved into `FetchOptions` alongside the URLs
    // that borrow it; `FetchTasklet` keeps the buffer alive for as long as the
    // URLs are read. Erase the borrow to a raw slice so borrowck doesn't tie
    // `url_static` to the local `url_proxy_boxed` binding.
    let buf_ptr: *const [u8] = &raw const *url_proxy_boxed;
    // SAFETY: `buf_ptr` points into `url_proxy_boxed` which the FetchTasklet
    // keeps alive for the lifetime of the parsed URLs (see comment above).
    // Explicit `&*` first to satisfy `dangerous_implicit_autorefs` — the
    // `Index` call would otherwise create an implicit `&` to `*buf_ptr`.
    let buf: &'static [u8] = unsafe { &*buf_ptr };
    let url_static: ZigURL<'static> = ZigURL::parse(&buf[..url_len]);
    let proxy_static: Option<ZigURL<'static>> = if has_proxy {
        Some(ZigURL::parse(&buf[url_len..]))
    } else {
        None
    };
    let fetch_options = FetchOptions {
        method,
        url: url_static,
        headers: headers.take().unwrap_or_default(),
        body,
        disable_keepalive,
        disable_timeout,
        idle_timeout_seconds,
        disable_decompression,
        max_redirects,
        reject_unauthorized,
        redirect_type,
        verbose,
        proxy: proxy_static,
        proxy_headers: proxy_headers.take(),
        url_proxy_buffer: url_proxy_boxed,
        signal: signal.take(),
        global_this: Some(global_this.into()),
        ssl_config: ssl_config.take(),
        hostname: hostname.take(),
        upgraded_connection,
        force_http2,
        force_http3,
        force_http1,
        is_node_http_client: ALLOW_GET_BODY,
        compress,
        check_server_identity: if check_server_identity.is_empty_or_undefined_or_null() {
            jsc::strong::Optional::empty()
        } else {
            jsc::strong::Optional::create(check_server_identity, global_this)
        },
        unix_socket_path: core::mem::replace(&mut unix_socket_path, ZigStringSlice::empty()),
    };

    let _ = FetchTasklet::queue(
        global_this,
        fetch_options,
        // Pass the Strong value instead of creating a new one, or else we
        // will leak it
        // see https://github.com/oven-sh/bun/issues/2985
        promise,
    );
    // `catch |err| bun.handleOom(err)` — FetchTasklet::queue aborts on OOM.

    // `body` has been *moved* into `FetchOptions`; the FetchTasklet now owns
    // the single live reference.

    Ok(promise_val)
}

// ──────────────────────────────────────────────────────────────────────────
// S3 ReadableStream upload Wrapper — module level because Rust does not allow
// `impl` blocks inside fn bodies for types referenced by external fn pointers.
// ──────────────────────────────────────────────────────────────────────────

struct S3StreamWrapper<'a> {
    promise: jsc::JSPromiseStrong,
    url: ZigURL<'a>,
    _url_proxy_buffer: Box<[u8]>,
    global: &'a JSGlobalObject,
}

impl<'a> S3StreamWrapper<'a> {
    pub(crate) fn resolve(
        result: s3::S3UploadResult,
        self_: *mut Self,
    ) -> Result<(), bun_jsc::JsTerminated> {
        // SAFETY: self_ was created via heap::alloc in fetch_impl; we reclaim
        // ownership here exactly once on the resolve callback.
        let mut self_ = unsafe { bun_core::heap::take(self_) };
        let global = self_.global;
        // `defer bun.destroy(self)` + `defer free(url_proxy_buffer)` →
        // Box<Self> and Box<[u8]> Drop at end of scope.
        match result {
            s3::S3UploadResult::Success => {
                let response = Box::new(Response::init(
                    response::Init {
                        method: Method::PUT,
                        status_code: 200,
                        ..Default::default()
                    },
                    Body::new(BodyValue::Empty),
                    BunString::create_atom_if_possible(self_.url.href),
                    false,
                ));
                // SAFETY: `into_raw` yields a freshly allocated heap `Response`;
                // ownership transfers to JSC.
                let response_js =
                    Response::make_maybe_pooled(global, bun_core::heap::into_raw(response));
                response_js.ensure_still_alive();
                self_.promise.resolve(global, response_js)?;
            }
            s3::S3UploadResult::Failure(err) => {
                let response = Box::new(Response::init(
                    response::Init {
                        method: Method::PUT,
                        status_code: 500,
                        status_text: BunString::create_atom_if_possible(err.code).into(),
                        ..Default::default()
                    },
                    Body::new(BodyValue::InternalBlob(InternalBlob {
                        bytes: err.message.to_vec(),
                        was_string: true,
                    })),
                    BunString::create_atom_if_possible(self_.url.href),
                    false,
                ));

                // SAFETY: `into_raw` yields a freshly allocated heap `Response`;
                // ownership transfers to JSC.
                let response_js =
                    Response::make_maybe_pooled(global, bun_core::heap::into_raw(response));
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
    // `if (old) |*h| h.deinit()` → Drop on `old`.
    drop(old);
}
