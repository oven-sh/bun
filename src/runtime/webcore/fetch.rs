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
pub(crate) mod fetch_tasklet;

#[path = "fetch/FetchRequestBodySink.rs"]
pub(crate) mod fetch_request_body_sink;
pub(crate) use self::fetch_request_body_sink::FetchRequestBodySink;

#[path = "fetch/compress_body.rs"]
pub(crate) mod compress_body;

#[path = "fetch/FetchSession.rs"]
pub(crate) mod fetch_session;
pub(crate) use self::fetch_session::FetchSession;

#[path = "fetch/RequestInit.rs"]
pub(crate) mod request_init;
use self::request_init::{HeadersInit, InitSources, flag};

#[path = "fetch/proxy_testing.rs"]
pub(crate) mod proxy_testing;

// ──────────────────────────────────────────────────────────────────────────
// fetch() implementation
// ──────────────────────────────────────────────────────────────────────────

use crate::webcore::jsc::{
    self as jsc, JSGlobalObject, JSPromise, JSValue, JsResult, VirtualMachine,
};
use bun_core::{String as BunString, Tag as BunStringTag};
use bun_http::http_request_body::StreamFraming;
use bun_http::{self as http, FetchRedirect, Headers, HeadersExt as _};
use bun_http_jsc::method_jsc;
use bun_http_types::Method::{Method, OwnedMethod};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{HTTPHeaderName, StringJsc as _, URLJsc as _};
use bun_sys::FdExt as _;
// `FromJsEnum for FetchRedirect` lives in bun_http_jsc; importing the impl crate
// brings the trait impl into scope for `JSValue::get_optional_enum::<FetchRedirect>`.
use crate::node;
use crate::node::types::PathLikeExt as _;
use crate::node::types::{Encoding, PathOrFileDescriptor};
use crate::webcore::blob::{BlobContentType, BlobExt as _};
use crate::webcore::body::{BodyMixin, InternalBlob, Value as BodyValue};
use crate::webcore::headers_ref::any_blob_content_type_opt;
use crate::webcore::response::HeadersRef;
use crate::webcore::s3::client as s3;
use crate::webcore::{Blob, Body, ObjectURLRegistry, ReadableStream, Request, Response};
use crate::webcore::{blob, readable_stream, response};
use bun_http_jsc as _;
use bun_http_jsc::headers_jsc::from_fetch_headers;
use bun_jsc::AbortSignalRef;
#[cfg(windows)]
use bun_paths::resolve_path::PosixToWinNormalizer;
use bun_picohttp as picohttp;
use bun_resolver::data_url::{DataURL, FetchDataURL};
use bun_s3_signing::{SignOptions, SignResult};
use bun_url::PercentEncoding;
use bun_url::URL as ZigURL;

use self::fetch_tasklet::{FetchOptions, HTTPRequestBody};
pub(crate) use self::fetch_tasklet::{
    FetchTasklet, FetchTaskletDeinitHop, FetchTaskletRequestDrain,
};

/// The `unix` option when it is a non-empty string.
fn parse_unix(
    vm: &VirtualMachine,
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<Box<[u8]>>> {
    if !value.is_string() || value.get_length(global)? == 0 {
        return Ok(None);
    }
    Ok(Some(absolute_unix_socket_path(
        vm.top_level_dir(),
        value.to_bun_string(global)?.to_owned_slice(),
    )))
}

/// The HTTP thread connects to the `unix` path later and the keep-alive pool
/// keys on it, so a relative path is anchored to `cwd` at call time, unnormalized.
fn absolute_unix_socket_path(cwd: &[u8], path: Vec<u8>) -> Box<[u8]> {
    // Windows: bsd.c has no long-path fallback. Leading NUL: Linux abstract socket.
    if cfg!(windows) || path.first() == Some(&0) || bun_paths::is_absolute(&path) {
        return path.into_boxed_slice();
    }
    bun_paths::join_sep_maybe_z::<false>(&[cwd, &path])
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

// ──────────────────────────────────────────────────────────────────────────
// dataURLResponse
// ──────────────────────────────────────────────────────────────────────────

/// `url` is the serialized URL without its fragment.
fn data_url_response(url: BunString, global_this: &JSGlobalObject) -> JsResult<JSValue> {
    let Some(FetchDataURL { mime_type, body }) = DataURL::process_for_fetch(url.to_utf8().slice())
    else {
        let err = global_this.to_type_error(
            jsc::ErrorCode::INVALID_URL,
            format_args!("failed to fetch the data URL"),
        );
        return Ok(JSPromise::rejected_promise(global_this, err).to_js());
    };

    // Set `Content-Type` now. The lazy copy from the body's Blob is lost once the body is consumed.
    let mut headers = HeadersRef::create_empty();
    headers.put(
        HTTPHeaderName::ContentType,
        &BunString::borrow_utf8(&mime_type),
        global_this,
    )?;

    let blob = Blob::init(body, global_this);
    // `Blob.type` is lowercase.
    blob.content_type
        .set(BlobContentType::Owned(std::sync::Arc::from(
            mime_type.to_ascii_lowercase(),
        )));

    let response = bun_core::heap::into_raw(Box::new(Response::init(
        response::Init {
            status_code: 200,
            status_text: BunString::create_atom(b"OK"),
            headers: Some(headers),
            ..Default::default()
        },
        Body::new(BodyValue::Blob(blob)),
        url,
        false,
    )));

    // Ownership of the boxed Response is transferred to the JS GC via
    // `make_maybe_pooled` (which stores the raw `*mut Response` in the wrapper
    // and finalizes it). Dropping a `Box<Response>` here would be a UAF.
    Ok(JSPromise::resolved_promise_value(
        global_this,
        // SAFETY: `response` is a freshly allocated heap `Response`; ownership
        // transfers to JSC.
        Response::make_maybe_pooled(global_this, response),
    ))
}

/// `fetch()` rejects with a `TypeError` that keeps the system error's `code`, `syscall` and `path`.
fn system_type_error(err: &bun_sys::Error, global_this: &JSGlobalObject) -> JSValue {
    jsc::SystemError::from(err.to_system_error()).to_type_error_instance(global_this)
}

/// Returns the `TypeError` that `fetch("file:...")` rejects with if reading `file_blob` can only fail.
fn file_url_unreadable_error(file_blob: &Blob, global_this: &JSGlobalObject) -> Option<JSValue> {
    // A file embedded in a standalone executable is a byte store and isn't on disk.
    let blob::store::Data::File(file) = &file_blob.store()?.data else {
        return None;
    };
    let PathOrFileDescriptor::Path(path) = &file.pathlike else {
        return None;
    };

    let mut path_buf = bun_paths::path_buffer_pool::get();
    // `stat`, not `open`: opening a FIFO blocks until it has a writer.
    let err = match bun_sys::stat(path.slice_z(&mut path_buf)) {
        Ok(stat) if bun_sys::S::ISDIR(stat.st_mode as _) => {
            bun_sys::Error::from_code(bun_sys::E::EISDIR, bun_sys::Tag::read)
        }
        Ok(_) => return None,
        Err(err) => err,
    };
    Some(system_type_error(&err.with_path(path.slice()), global_this))
}

// ──────────────────────────────────────────────────────────────────────────
// fetch.preconnect
// ──────────────────────────────────────────────────────────────────────────

pub(crate) fn preconnect(cx: &mut JsScope<'_>, url: &BunString) -> JsResult<()> {
    let global_object = cx.global();

    let url_str = bun_url::href_from_string(url);

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
                format_args!("fetch() URL must not be a blank string."),
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

    if !url.is_http() && !url.is_https() {
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
                format_args!("fetch() URL must not be a blank string."),
            )
            .throw());
    }

    if !url.has_valid_port() {
        reclaim_href!();
        return Err(global_object.throw_invalid_arguments(format_args!("Invalid port")));
    }

    // `preconnect` is a free fn in `bun_http::async_http`. Ownership
    // of `href_raw` transfers here (`is_url_owned: true`).
    // A request to an origin the environment proxies never dials it.
    let vm = VirtualMachine::get();
    if vm.env_loader().get_http_proxy_for(&url).is_some() {
        reclaim_href!();
        return Ok(());
    }
    http::async_http::preconnect(url, true, crate::socket::http_client_defaults(vm));
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// StringOrURL helper
// ──────────────────────────────────────────────────────────────────────────

struct StringOrURL;

impl StringOrURL {
    fn from_js(value: JSValue, global_this: &JSGlobalObject) -> JsResult<Option<BunString>> {
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
// fetch entry point
// ──────────────────────────────────────────────────────────────────────────

/// Public entry point for `Bun.fetch` - validates body on GET/HEAD
pub(crate) fn fetch(
    cx: &mut JsScope<'_>,
    input: JsLocal<'_>,
    init: JsLocal<'_>,
) -> JsResult<JSValue> {
    fetch_impl(cx.global(), input.to_js(), init.to_js(), None)
}

/// What `session.fetch` is bound from: `fetch()` with `this` as its session.
pub(crate) fn session_fetch(
    cx: &mut JsScope<'_>,
    this_value: JsLocal<'_>,
    input: JsLocal<'_>,
    init: JsLocal<'_>,
) -> JsResult<JSValue> {
    fetch_impl(
        cx.global(),
        input.to_js(),
        init.to_js(),
        Some(this_value.to_js()),
    )
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

/// Nothing was queued yet: cancel a stream body with `reason` and reject with it.
fn reject_before_send(
    global_this: &JSGlobalObject,
    body: &mut HTTPRequestBody,
    reason: JSValue,
) -> JsResult<JSValue> {
    if let HTTPRequestBody::ReadableStream(stream_ref) = &*body {
        if let Some(stream) = stream_ref.get() {
            stream.cancel_with_reason(global_this, reason)?;
        }
    }
    body.detach();
    Ok(JSPromise::rejected_promise(global_this, reason).to_js())
}

/// Shared implementation of fetch
fn fetch_impl(
    ctx: &JSGlobalObject,
    first_arg: JSValue,
    options: JSValue,
    // `session.fetch()`: the session, which a `session` in the init does not replace.
    bound_session: Option<JSValue>,
) -> JsResult<JSValue> {
    let context = ctx.bun_vm().context_of_caller_no_frame();
    // What script of a disposed `Bun.ModuleGraph` starts does not start, and reports nothing: no
    // connection goes out, and the promise stays pending.
    if context.is_stopped() {
        return Ok(JSPromise::create(ctx).to_js());
    }
    jsc::mark_binding();
    let global_this = ctx;
    bun_core::analytics::Features::FETCH.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
    // SAFETY: `VirtualMachine::get()` returns the live thread-local VM pointer; it
    // outlives this call frame.
    let vm = VirtualMachine::get().as_mut();

    let mut upgraded_connection = false;

    let vm_verbose_fetch = vm.get_verbose_fetch();

    let mut idle_timeout_seconds: Option<core::ffi::c_uint> = None;
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
    let mut range: Option<bun_core::ZBox> = None;

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

    let mut reject_unauthorized = vm.get_tls_reject_unauthorized();
    let mut check_server_identity: JSValue = JSValue::ZERO;

    // signal/unix_socket_path/url_proxy_buffer/headers/body/range/
    // ssl_config are all owning types whose Drop runs on early return.

    let options_object: Option<JSValue> = 'brk: {
        if options.is_object() || options.js_type() == jsc::JSType::DOMWrapper {
            break 'brk Some(options);
        }
        break 'brk None;
    };

    let request: Option<&Request> = if first_arg.is_cell() {
        // SAFETY: `first_arg`, which the call frame keeps alive, owns the Request.
        first_arg.as_direct::<Request>().map(|p| unsafe { &*p })
    } else {
        None
    };

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

    let url_str: BunString = 'extract_url: {
        if let Some(str) = url_str_optional {
            break 'extract_url str;
        }

        if let Some(req) = request {
            let _ = req.ensure_url(); // bun.handleOom — aborts on OOM
            break 'extract_url req.url.get().clone();
        }

        if let Some(request_init) = request_init_object {
            if let Some(url_) = request_init.fast_get(global_this, jsc::BuiltinName::Url)? {
                if !url_.is_undefined() {
                    break 'extract_url BunString::from_js(url_, global_this)?;
                }
            }
        }

        let err = ctx.to_type_error(
            jsc::ErrorCode::INVALID_URL,
            format_args!("fetch() URL is invalid"),
        );
        return Ok(JSPromise::rejected_promise(global_this, err).to_js());
    };

    if url_str.is_empty() {
        let err = ctx.to_type_error(
            jsc::ErrorCode::INVALID_URL,
            format_args!("fetch() URL must not be a blank string."),
        );
        return Ok(JSPromise::rejected_promise(global_this, err).to_js());
    }

    // A fetch never uses the fragment, and `Response.url` excludes it.
    let href = bun_url::href_from_string_without_fragment(&url_str);
    if href.tag() == BunStringTag::Dead {
        let err = ctx.to_type_error(
            jsc::ErrorCode::INVALID_URL,
            format_args!("fetch() URL is invalid"),
        );
        return Ok(JSPromise::rejected_promise(global_this, err).to_js());
    }

    if href.starts_with_ascii(b"data:") {
        return data_url_response(href, global_this);
    }

    // Move the href into `url_proxy_buffer` and re-parse `url` to borrow it.
    let mut url_proxy_buffer = href.to_owned_slice();
    if url_proxy_buffer.starts_with(b"s3:") {
        // `#` is part of an S3 key.
        url_proxy_buffer = bun_url::href_from_string(&url_str).to_owned_slice();
    }
    let mut url = parse_url_detached!(&url_proxy_buffer[..]);
    if url.is_file() {
        url_type = URLType::File;
    } else if url.is_blob() {
        url_type = URLType::Blob;
    }

    // **Start with the harmless ones.**

    let sources = InitSources {
        init: options_object,
        request,
        object: request_init_object,
    };

    // "method"
    let mut method: OwnedMethod = sources
        .member(
            |object| match object.fast_get_truthy(global_this, jsc::BuiltinName::method)? {
                Some(method) => method_jsc::request_method_from_js(global_this, method).map(Some),
                None => Ok(None),
            },
            |req| Ok(Some(req.method.clone())),
        )?
        .unwrap_or_else(|| Method::GET.into());

    // "decompress: boolean"
    let disable_decompression = sources
        .option(global_this, jsc::CommonString::FetchOptionDecompress, |v| {
            Ok(flag(v))
        })?
        .is_some_and(|decompress| !decompress);

    // "compress: boolean | string | { encoding, level? }"
    let mut compress: Option<compress_body::CompressOption> = sources
        .option(global_this, jsc::CommonString::FetchOptionCompress, |v| {
            compress_body::from_js(global_this, v).map(Some)
        })?
        .flatten();

    // "maxRedirects: number"
    let max_redirects: Option<u8> = sources.option(
        global_this,
        jsc::CommonString::FetchOptionMaxRedirects,
        |value| {
            if value.is_null() {
                return Ok(None);
            }
            let n = if value.is_number() {
                value.as_number()
            } else {
                f64::NAN
            };
            if n.is_nan() || n < 0.0 || n.fract() != 0.0 {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "fetch: 'maxRedirects' must be a non-negative integer"
                )));
            }
            Ok(Some(n.min(126.0) as u8))
        },
    )?;

    // "session: Bun.FetchSession"
    let session_hold: Option<fetch_session::SessionHold> = match bound_session {
        Some(bound) => Some(fetch_session::SessionHold::from_js(global_this, bound)?),
        None => sources.option(
            global_this,
            jsc::CommonString::FetchOptionSession,
            |value| {
                if value.is_null() {
                    return Ok(None);
                }
                fetch_session::SessionHold::from_js(global_this, value).map(Some)
            },
        )?,
    };
    let session = session_hold.as_ref();

    // "tls: TLSConfig". A request's `tls` replaces its session's as a whole.
    let mut request_has_tls = false;
    let mut ssl_config: Option<http::ssl_config::SharedPtr> =
        sources.option(global_this, jsc::CommonString::FetchOptionTls, |tls| {
            if !tls.is_object() {
                return Ok(None);
            }
            request_has_tls = true;
            let parsed = fetch_session::parse_tls(vm, global_this, tls)?;
            if let Some(reject) = parsed.reject_unauthorized {
                reject_unauthorized = reject;
            }
            if let Some(callback) = parsed.check_server_identity {
                check_server_identity = callback;
            }
            Ok(parsed.ssl_config)
        })?;
    // A per-request closure has no identity a pool key could compare.
    let bypass_pool = !check_server_identity.is_empty();
    // The session's callbacks stay on the session, which the request keeps alive.
    let mut session_check_server_identity = false;
    if let Some(session) = session.filter(|_| !request_has_tls) {
        ssl_config = session.ssl_config();
        reject_unauthorized = session.reject_unauthorized().unwrap_or(reject_unauthorized);
        session_check_server_identity = session.check_server_identity().is_some();
    }
    if ssl_config.is_none() {
        ssl_config = crate::socket::http_client_defaults(vm);
    }

    // unix: string | undefined
    let mut unix_socket_path: Box<[u8]> = sources
        .option(
            global_this,
            jsc::CommonString::FetchOptionUnix,
            |socket_path| {
                let path = parse_unix(vm, global_this, socket_path)?;
                // Ignoring it would send the request to the URL's host over TCP.
                if path.is_none() && !socket_path.is_string() && socket_path.to_boolean() {
                    return Err(global_this
                        .throw_invalid_arguments(format_args!("fetch: 'unix' must be a string")));
                }
                Ok(path)
            },
        )?
        .unwrap_or_default();
    let request_has_unix = !unix_socket_path.is_empty();

    // protocol: "http2" | "h2" | "http1.1" | "h1" | undefined.
    let forced_protocol: Option<http::Protocol> = sources.option(
        global_this,
        jsc::CommonString::FetchOptionProtocol,
        |protocol| {
            if !protocol.is_string() {
                return Ok(None);
            }
            let str = protocol.to_js_string_view(global_this)?;
            if str.eq_ascii(b"http2") || str.eq_ascii(b"h2") {
                Ok(Some(http::Protocol::Http2))
            } else if str.eq_ascii(b"http3") || str.eq_ascii(b"h3") {
                Ok(Some(http::Protocol::Http3))
            } else if str.eq_ascii(b"http1.1") || str.eq_ascii(b"h1") {
                Ok(Some(http::Protocol::Http1_1))
            } else {
                Err(global_this.throw_invalid_arguments(format_args!(
                    "fetch: 'protocol' must be \"http2\", \"h2\", \"http3\", \"h3\", \"http1.1\", or \"h1\""
                )))
            }
        },
    )?;

    // timeout: false | number | undefined
    let disable_timeout = sources
        .option(
            global_this,
            jsc::CommonString::FetchOptionTimeout,
            |timeout| {
                if !timeout.is_number() {
                    return Ok(flag(timeout).map(|enabled| !enabled));
                }
                // A finite positive `timeout` (in ms) also governs the socket idle deadline, instead of `BUN_CONFIG_HTTP_IDLE_TIMEOUT`.
                let ms = timeout.as_number();
                if ms.is_finite() && ms > 0.0 {
                    idle_timeout_seconds =
                        Some((ms / 1000.0).ceil().min(core::ffi::c_uint::MAX as f64)
                            as core::ffi::c_uint);
                }
                // `to_int32()` saturates ±Infinity, which has to disable the timer like 0 does.
                Ok(Some(!ms.is_finite() || timeout.to_int32() == 0))
            },
        )?
        .unwrap_or(false);

    // redirect: "follow" | "error" | "manual" | undefined;
    let redirect_type: FetchRedirect = sources
        .member(
            |object| object.get_optional_enum::<FetchRedirect>(global_this, "redirect"),
            |req| Ok(Some(req.flags.redirect)),
        )?
        .unwrap_or(FetchRedirect::Follow);

    // keepalive: boolean | undefined; the session's setting is the default.
    let disable_keepalive = sources
        .option(global_this, jsc::CommonString::FetchOptionKeepalive, |v| {
            Ok(flag(v))
        })?
        .map_or_else(
            || session.is_some_and(|c| !c.keep_alive()),
            |keepalive| !keepalive,
        );

    // verbose: boolean | "curl" | undefined;
    if let Some(level) =
        sources.option(global_this, jsc::CommonString::FetchOptionVerbose, |verb| {
            Ok(if verb.is_string() {
                verb.to_js_string_view(global_this)?
                    .eq_ascii(b"curl")
                    .then_some(http::HTTPVerboseLevel::Curl)
            } else if verb.is_boolean() {
                Some(if verb.to_boolean() {
                    http::HTTPVerboseLevel::Headers
                } else {
                    http::HTTPVerboseLevel::None
                })
            } else {
                None
            })
        })?
    {
        verbose = level;
    }

    // proxy: string | URL | { url, headers?, respectNoProxy? } | false | undefined;
    let mut proxy_headers: Option<Headers> = None;
    let mut proxy_direct = false;
    let mut proxy_respects_no_proxy = true;
    {
        let proxy_option: Option<fetch_session::ProxyOption> = sources.option(
            global_this,
            jsc::CommonString::FetchOptionProxy,
            |proxy_arg| {
                Ok(match fetch_session::parse_proxy(global_this, proxy_arg)? {
                    fetch_session::ProxyArg::Policy(policy) => Some(policy),
                    _ => None,
                })
            },
        )?;
        // The request's own `unix` or `proxy` wins over whichever of the two
        // its session names; they cannot be combined.
        if let Some(session) = session {
            if !request_has_unix
                && !matches!(
                    proxy_option,
                    Some(fetch_session::ProxyOption::Explicit { .. })
                )
            {
                unix_socket_path = session.unix().into();
            }
        }
        let proxy_option = match (proxy_option, session.and_then(|c| c.proxy())) {
            (None, Some(fetch_session::ProxyOption::Explicit { .. })) if request_has_unix => None,
            (None, Some(from_session)) => Some(from_session.clone()),
            (own, _) => own,
        };
        match proxy_option {
            None => {}
            Some(fetch_session::ProxyOption::Direct) => {
                proxy_direct = true;
            }
            Some(fetch_session::ProxyOption::Explicit {
                href,
                headers,
                respect_no_proxy,
            }) => {
                let mut buffer: Vec<u8> = Vec::with_capacity(url_proxy_buffer.len() + href.len());
                buffer.extend_from_slice(&url_proxy_buffer);
                buffer.extend_from_slice(&href);
                let url_len = url.href.len();
                url = parse_url_detached!(&buffer[0..url_len]);
                proxy = Some(parse_url_detached!(&buffer[url_len..]));
                url_proxy_buffer = buffer;
                proxy_headers = headers;
                proxy_respects_no_proxy = respect_no_proxy;
            }
        }
    }

    let pool = session.map(|c| c.pool()).unwrap_or_default();

    // signal: AbortSignal | null | undefined;
    let signal: Option<AbortSignalRef> = sources
        .member(
            |object| {
                request_init::signal_member(global_this, object, || {
                    global_this.throw_value(ctx.to_type_error(
                        jsc::ErrorCode::INVALID_ARG_TYPE,
                        format_args!("signal is not of type AbortSignal."),
                    ))
                })
            },
            |req| Ok(Some(req.abort_signal().map(|signal| signal.ref_()))),
        )?
        .flatten();

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
    let mut body = sources
        .member(
            |object| match object.fast_get(global_this, jsc::BuiltinName::Body)? {
                Some(body) => HTTPRequestBody::from_js(&ctx.js_thread(context), body).map(Some),
                None => Ok(None),
            },
            |req| {
                if BodyMixin::body_unusable(req, global_this).is_some() {
                    return Err(global_this
                        .err(
                            jsc::ErrorCode::BODY_ALREADY_USED,
                            format_args!("Request body already used"),
                        )
                        .throw());
                }

                BodyMixin::copy_content_type_to_headers(req, global_this)?;
                let body_value = req.get_body_value();
                body_value.to_blob_if_in_memory();
                if matches!(*body_value, BodyValue::Locked(_)) {
                    if let Some(readable) = req.get_body_readable_stream() {
                        return Ok(Some(HTTPRequestBody::ReadableStream(
                            readable_stream::Strong::init(readable, global_this),
                        )));
                    }
                    let body_value = req.get_body_value();
                    let readable =
                        body_value.to_readable_stream(&global_this.js_thread(context))?;
                    if !readable.is_empty_or_undefined_or_null() {
                        if let BodyValue::Locked(locked) = body_value {
                            if locked.readable.has() {
                                return Ok(Some(HTTPRequestBody::ReadableStream(
                                    readable_stream::Strong::init(
                                        locked.readable.get().unwrap(),
                                        global_this,
                                    ),
                                )));
                            }
                        }
                    }
                }

                Ok(Some(HTTPRequestBody::AnyBlob(
                    req.get_body_value().use_as_any_blob(),
                )))
            },
        )?
        .unwrap_or_default();

    // headers: Headers | undefined;
    let fetch_headers: Option<HeadersInit> = sources
        .member(
            |object| match object.fast_get(global_this, jsc::BuiltinName::Headers)? {
                Some(headers) => HeadersInit::from_js(global_this, headers).map(Some),
                None => Ok(None),
            },
            |req| {
                Ok(Some(req.get_fetch_headers_unless_empty().and_then(
                    |headers| core::ptr::NonNull::new(headers.as_ptr()).map(HeadersInit::Borrowed),
                )))
            },
        )?
        .flatten();
    let mut headers: Option<Headers> = match &fetch_headers {
        Some(fetch_headers) => {
            let fetch_headers = fetch_headers.get();
            if url.is_s3() {
                if let Some(range_) = fetch_headers.fast_get(HTTPHeaderName::Range) {
                    range = Some(range_.to_owned_slice_z());
                }
            }

            if let Some(upgrade_) = fetch_headers.fast_get(HTTPHeaderName::Upgrade) {
                if http::upgrade_header_is_not_h2(upgrade_.to_utf8().slice()) {
                    upgraded_connection = true;
                }
            }

            Some(from_fetch_headers(
                global_this,
                Some(fetch_headers),
                any_blob_content_type_opt(body.get_any_blob().map(|b| &*b)),
            )?)
        }
        None => None,
    };
    drop(fetch_headers);

    if proxy.is_some() && !unix_socket_path.is_empty() {
        let err = ctx.to_type_error(
            jsc::ErrorCode::INVALID_ARG_VALUE,
            format_args!("fetch() cannot use a proxy with a unix socket."),
        );
        return Ok(JSPromise::rejected_promise(global_this, err).to_js());
    }

    // This is not 100% correct.
    // We don't pass along headers, we ignore method, we ignore status code...
    // But it's better than status quo.
    if url_type != URLType::Remote {
        // https://url.spec.whatwg.org/#file-host: a file: URL names a local file
        // only when its host is empty or "localhost".
        if url_type == URLType::File
            && !url.hostname.is_empty()
            && !bun_core::strings::eql_case_insensitive_ascii(url.hostname, b"localhost", true)
        {
            // On Windows Node reads such a URL as a UNC path.
            let err = if cfg!(windows) {
                global_this.to_type_error(
                    jsc::ErrorCode::INVALID_FILE_URL_HOST,
                    format_args!(
                        "File URL host must be \"localhost\" or empty: fetch() does not read UNC paths"
                    ),
                )
            } else {
                global_this.to_type_error(
                    jsc::ErrorCode::INVALID_FILE_URL_HOST,
                    format_args!(
                        "File URL host must be \"localhost\" or empty on {}",
                        bun_core::Global::os_name
                    ),
                )
            };
            return Ok(JSPromise::rejected_promise(global_this, err).to_js());
        }
        // As `fileURLToPath` does: an encoded separator would become a real
        // one below, and walk out of whatever the caller checked `pathname` against.
        if url_type == URLType::File {
            let mut encoded_separator = false;
            let mut rest = url.path;
            while let Some(percent) = bun_core::strings::index_of_char(rest, b'%') {
                rest = &rest[percent as usize + 1..];
                encoded_separator = match rest {
                    [b'2', b'f' | b'F', ..] => true,
                    [b'5', b'c' | b'C', ..] => cfg!(windows),
                    _ => false,
                };
                if encoded_separator {
                    break;
                }
            }
            if encoded_separator {
                let message = if cfg!(windows) {
                    "File URL path must not include encoded \\ or / characters"
                } else {
                    "File URL path must not include encoded / characters"
                };
                let err = global_this.to_type_error(
                    jsc::ErrorCode::INVALID_FILE_URL_PATH,
                    format_args!("{message}"),
                );
                return Ok(JSPromise::rejected_promise(global_this, err).to_js());
            }
        }
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut path_buf2 = bun_paths::path_buffer_pool::get();
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
        // `open` would truncate the path at a decoded `%00`. `Bun.file(url)` and node:fs reject it the same way.
        if url_type == URLType::File {
            crate::node::types::Valid::path_null_bytes(url_path_decoded, global_this)?;
        }

        let url_string: BunString;

        // This can be a blob: url or a file: url.
        let blob_to_use: Blob = 'blob: {
            // Support blob: urls
            if url_type == URLType::Blob {
                if let Some(blob) =
                    ObjectURLRegistry::singleton().resolve_and_dupe(url_path_decoded, global_this)
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
                    return Ok(JSPromise::rejected_promise(global_this, err).to_js());
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
                let mut cwd_buf = bun_paths::path_buffer_pool::get();
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
                let cwd = bun_resolver::fs::FileSystem::get().top_level_dir();

                // SAFETY: bun_vm() returns the live thread-local VM pointer.
                // Relative to the folder of the entry module, or to the working directory when there
                // is none (`bun bake`).
                let parts: &[&[u8]] = match global_this.bun_vm().as_mut().main() {
                    Some(main) => &[main, b"../", url_path_decoded],
                    None => &[url_path_decoded],
                };
                let fullpath = bun_paths::resolve_path::join_abs_string_buf::<
                    bun_paths::platform::Auto,
                >(cwd, &mut path_buf, parts);
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

            url_string = bun_url::file_url_from_string(&BunString::borrow_utf8(temp_file_path));

            // `find_or_create_file_from_path` is typed against the
            // `crate::webcore::node_types` stub (until it's swapped to a
            // re-export of `crate::node::types`); construct that variant here.
            let mut pathlike = crate::webcore::node_types::PathOrFileDescriptor::Path(
                crate::webcore::node_types::PathLike::owned(temp_file_path.to_vec()),
            );

            let file_blob = Blob::find_or_create_file_from_path(&mut pathlike, global_this, true);
            if let Some(err) = file_url_unreadable_error(&file_blob, global_this) {
                return Ok(JSPromise::rejected_promise(global_this, err).to_js());
            }
            break 'blob file_blob;
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
            return Ok(JSPromise::rejected_promise(global_this, err).to_js());
        }
    }

    // WHATWG Fetch step 36 forbids a body for GET/HEAD; Bun additionally
    // rejects TRACE (RFC 9110 §9.3.8 "MUST NOT send content") since it does
    // not enforce forbidden methods. has_request_body() encodes exactly that.
    if method.known().is_some_and(|verb| !verb.has_request_body())
        && body.has_body()
        && !upgraded_connection
    {
        let err = global_this.to_type_error(
            jsc::ErrorCode::INVALID_ARG_VALUE,
            format_args!("fetch() request with GET/HEAD method cannot have body."),
        );
        return Ok(JSPromise::rejected_promise(global_this, err).to_js());
    }

    // Fetch spec step 11: reject synchronously for a pre-aborted signal. Runs
    // after body/header extraction so Request-constructor errors (GET+body,
    // already-used body) win and `request.bodyUsed` is set, matching Node.
    if let Some(sig) = &signal {
        if sig.aborted() {
            let reason = sig.js_reason(global_this);
            return reject_before_send(global_this, &mut body, reason);
        }
    }

    if headers.is_none() && body.has_content_type_from_user() {
        headers = Some(from_fetch_headers(
            global_this,
            None,
            any_blob_content_type_opt(body.get_any_blob().map(|b| &*b)),
        )?);
    }

    // Userinfo in the URL is the request's credentials, like curl and
    // `node:http`; an explicit Authorization header wins.
    if !(url.username.is_empty() && url.password.is_empty())
        && !url.is_s3()
        && !headers
            .as_ref()
            .is_some_and(|h| h.get(b"authorization").is_some())
    {
        if let Some(credentials) = http::async_http::basic_authorization(&url) {
            headers
                .get_or_insert_default()
                .append(b"Authorization", &credentials);
        }
    }

    // `body` is mutated in place for the sendfile/readfile paths and then
    // *moved* into `FetchOptions`.

    if body.is_s3() {
        'prepare_body: {
            // is a S3 file we can use chunked here

            if let Some(stream) = ReadableStream::from_js(
                ReadableStream::from_blob_copy_ref(
                    &global_this.js_thread(context),
                    body.blob(),
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
                old.detach();
                break 'prepare_body;
            }
            let rejected_value = JSPromise::rejected_promise(
                global_this,
                global_this.create_error_instance(format_args!("Failed to start s3 stream")),
            )
            .to_js();
            body.detach();
            return Ok(rejected_value);
        }
    }
    if body.needs_to_read_file() {
        'prepare_body: {
            // A local `PathBuffer` serves as NUL-termination scratch for
            // `path.slice_z()` (the `vm.node_fs()` accessor is gated behind a
            // jsc↔runtime cycle).
            let mut open_path_buf = bun_paths::path_buffer_pool::get();
            let opened_fd_res: bun_sys::Result<bun_sys::Fd> = {
                let store = body.store().expect("needs_to_read_file implies store");
                match &store.data.as_file().pathlike {
                    // On Windows `read_file` would wrap dup's HANDLE in a CRT fd that the close below never frees.
                    PathOrFileDescriptor::Fd(fd) => bun_sys::dup(*fd).and_then(|duped| {
                        duped.make_lib_uv_owned_for_syscall(
                            bun_sys::Tag::dup,
                            bun_sys::ErrorCase::CloseOnFail,
                        )
                    }),
                    PathOrFileDescriptor::Path(path) => {
                        let zpath = path.slice_z(&mut open_path_buf);
                        let flags = if cfg!(windows) {
                            bun_sys::O::RDONLY
                        } else {
                            bun_sys::O::RDONLY | bun_sys::O::NOCTTY
                        };
                        // On Windows `zpath` starts with `\\?\`. Report the caller's path, like `.text()` does.
                        bun_sys::open(zpath, flags, 0).map_err(|err| err.with_path(path.slice()))
                    }
                }
            };

            let opened_fd = match opened_fd_res {
                Err(err) => {
                    let err_js = system_type_error(&err, global_this);
                    let rejected_value = JSPromise::rejected_promise(global_this, err_js).to_js();
                    return Ok(rejected_value);
                }
                Ok(fd) => fd,
            };

            // An explicit `compress` request always wins over the sendfile
            // heuristic — otherwise the same `Bun.file()` body would compress
            // over https/proxy/<32 KiB/Windows but silently not over plain http.
            let env_proxy_is_tls = !proxy_direct
                && vm
                    .env_loader()
                    .get_http_proxy_for(&url)
                    .is_some_and(|env_proxy| env_proxy.is_https());
            if proxy.is_none()
                && !env_proxy_is_tls
                && compress.is_none()
                && http::SendFile::is_eligible(&url)
            {
                'use_sendfile: {
                    let stat: bun_sys::Stat = match bun_sys::fstat(opened_fd) {
                        Ok(result) => result,
                        // bail out for any reason
                        Err(_) => break 'use_sendfile,
                    };

                    // A redirect sends the body again from its first byte, so the fd has to be seekable.
                    if !bun_sys::S::ISREG(stat.st_mode as u32) {
                        break 'use_sendfile;
                    }

                    // if it's < 32 KB, it's not worth it
                    if stat.st_size < 32 * 1024 {
                        break 'use_sendfile;
                    }

                    let original_size = body.blob().size.get();
                    let stat_size = blob::SizeType::try_from(stat.st_size).expect("int cast");
                    let blob_offset = body.blob().offset.get();

                    // `http::SendFile` fields are `usize`; blob sizes/offsets
                    // are `blob::SizeType` (u64) — hence the `as usize` casts.
                    let mut sf = http::SendFile {
                        fd: opened_fd,
                        remain: (blob_offset + original_size) as usize,
                        offset: blob_offset as usize,
                        content_size: original_size.min(stat_size) as usize,
                    };

                    let stat_size_usize = stat_size as usize;
                    sf.offset = sf.offset.min(stat_size_usize);
                    sf.remain = sf
                        .remain
                        .max(sf.offset)
                        .min(stat_size_usize)
                        .saturating_sub(sf.offset);
                    // `remain` is now the slice window clamped to the file, which is the Content-Length.
                    sf.content_size = sf.remain;
                    body.detach();

                    // macOS and FreeBSD read a sendfile(2) length of 0 as "until end of file".
                    if sf.remain == 0 {
                        opened_fd.close();
                        break 'prepare_body;
                    }

                    body = HTTPRequestBody::Sendfile(sf);

                    break 'prepare_body;
                }
            }

            // The sendfile path above closes `opened_fd` or moves it into `SendFile` (which
            // owns its lifecycle and breaks out of `'prepare_body`). On this
            // read-file path we are the sole owner of the fresh fd: `read_file`
            // is handed it as an `Fd` and never takes ownership. Wrap it in an
            // RAII guard so any future early return between here and the read
            // can't leak it.
            let opened_fd = scopeguard::guard(opened_fd, |fd| fd.close());

            // TODO: make this async + lazy
            let blob_offset = body.blob().offset.get();
            let blob_size = body.blob().size.get();
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
                    let err_js = system_type_error(&err, global_this);
                    let rejected_value = JSPromise::rejected_promise(global_this, err_js).to_js();
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
            if let Some(s3_options) =
                options.get_common_string(global_this, jsc::CommonString::FetchOptionS3)?
            {
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

            if !matches!(method.known(), Some(Method::PUT | Method::POST)) {
                return Ok(JSPromise::rejected_promise(
                    global_this,
                    global_this.create_error_instance(format_args!(
                        "Only POST and PUT do support body when using S3"
                    )),
                )
                .to_js());
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
            } else if proxy_direct {
                Some(b"")
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
                readable_stream.get().unwrap(),
                &global_this.js_thread(context),
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
        let sign_method = match method.known() {
            Some(Method::POST) => Method::PUT,
            Some(verb) => verb,
            None => {
                return Ok(JSPromise::rejected_promise(
                    global_this,
                    s3::get_js_sign_error(bun_s3_signing::Error::InvalidMethod, global_this),
                )
                .to_js());
            }
        };
        method = sign_method.into();

        let mut result = match credentials_with_options.credentials.sign_request::<false>(
            &SignOptions {
                path: url.s3_path(),
                method: sign_method,
                ..Default::default()
            },
            None,
        ) {
            Ok(r) => r,
            Err(sign_err) => {
                return Ok(JSPromise::rejected_promise(
                    global_this,
                    s3::get_js_sign_error(sign_err.into(), global_this),
                )
                .to_js());
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

    // Decided before anything is queued, so an unusable framing header rejects up front.
    let mut stream_framing = StreamFraming::default();
    if matches!(body, HTTPRequestBody::ReadableStream(_))
        && let Some(request_headers) = &headers
    {
        stream_framing = if upgraded_connection {
            StreamFraming::for_upgrade(request_headers)
        } else {
            match StreamFraming::for_body(request_headers) {
                Ok(framing) => framing,
                Err(invalid) => {
                    let err = global_this.to_type_error(
                        jsc::ErrorCode::HTTP_INVALID_HEADER_VALUE,
                        format_args!(
                            "Invalid value \"{}\" for header \"{}\"",
                            bstr::BStr::new(invalid.value),
                            invalid.name
                        ),
                    );
                    return reject_before_send(global_this, &mut body, err);
                }
            }
        };
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
    // `url` still points into `buf` unless `into_boxed_slice` had to shrink the allocation and moved it.
    let url_static: ZigURL<'static> = if core::ptr::eq(url.href.as_ptr(), buf.as_ptr()) {
        url
    } else {
        ZigURL::parse(&buf[..url_len])
    };
    let proxy_static: Option<&'static [u8]> = if has_proxy {
        Some(&buf[url_len..])
    } else {
        None
    };
    let mut request_headers = headers.take().unwrap_or_default();
    let fetch_options = FetchOptions {
        method: method.to_ref(&mut request_headers),
        url: url_static,
        headers: request_headers,
        body,
        stream_framing,
        disable_keepalive,
        disable_timeout,
        idle_timeout_seconds,
        disable_decompression,
        max_redirects,
        reject_unauthorized,
        redirect_type,
        verbose,
        proxy: match proxy_static {
            Some(href) => fetch_tasklet::ProxyPolicy::Explicit {
                href,
                respect_no_proxy: proxy_respects_no_proxy,
            },
            None if proxy_direct => fetch_tasklet::ProxyPolicy::Direct,
            None => fetch_tasklet::ProxyPolicy::Env,
        },
        proxy_headers: proxy_headers.take(),
        url_proxy_buffer: url_proxy_boxed,
        signal,
        ssl_config: ssl_config.take(),
        upgraded_connection,
        forced_protocol,
        compress,
        check_server_identity: if check_server_identity.is_empty_or_undefined_or_null() {
            jsc::strong::Optional::empty()
        } else {
            jsc::strong::Optional::create(check_server_identity, global_this)
        },
        unix_socket_path: core::mem::take(&mut unix_socket_path),
        pool,
        bypass_pool,
        fetch_session: session_hold,
        session_check_server_identity,
    };

    let _ = FetchTasklet::queue(
        &global_this.js_thread(context),
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
    fn resolve(result: s3::S3UploadResult, self_: *mut Self) -> JsResult<()> {
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
                        status_text: BunString::create_atom_if_possible(err.code),
                        ..Default::default()
                    },
                    Body::new(BodyValue::InternalBlob(InternalBlob::from_string_bytes(
                        err.message.to_vec(),
                    ))),
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
