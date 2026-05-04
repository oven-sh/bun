use core::ffi::c_int;
use core::ptr::NonNull;
use std::io::Write as _;

use enum_map::EnumMap;

use bun_core::Output;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, VirtualMachine};
use bun_jsc::c::JSType;
use bun_str::{self as strings, String as BunString, ZigString};
use bun_paths::{self, PathBuffer};
use bun_http::{self as http, FetchRedirect, Headers, MimeType};
use bun_http_types::Method;
use bun_url::URL as ZigURL;
use bun_url::PercentEncoding;
use bun_resolver::data_url::DataURL;
use bun_runtime::api::server::ServerConfig::SSLConfig;
use bun_runtime::webcore::{AbortSignal, Blob, Body, FetchHeaders, ObjectURLRegistry, ReadableStream, Request, Response};
use bun_runtime::node as node;
use bun_paths::PosixToWinNormalizer;
use bun_picohttp as picohttp;
use bun_s3 as s3;

// ──────────────────────────────────────────────────────────────────────────
// Error message constants
// ──────────────────────────────────────────────────────────────────────────

pub const FETCH_ERROR_NO_ARGS: &str = "fetch() expects a string but received no arguments.";
pub const FETCH_ERROR_BLANK_URL: &str = "fetch() URL must not be a blank string.";
pub const FETCH_ERROR_UNEXPECTED_BODY: &str =
    "fetch() request with GET/HEAD/OPTIONS method cannot have body.";
pub const FETCH_ERROR_PROXY_UNIX: &str = "fetch() cannot use a proxy with a unix socket.";

type JSTypeErrorEnum = EnumMap<JSType, &'static str>;

// TODO(port): EnumMap::from_array const-init requires #[derive(enum_map::Enum)] on JSType
// with variants in this exact order; verify in Phase B.
pub const FETCH_TYPE_ERROR_NAMES: JSTypeErrorEnum = EnumMap::from_array([
    /* kJSTypeUndefined */ "Undefined",
    /* kJSTypeNull      */ "Null",
    /* kJSTypeBoolean   */ "Boolean",
    /* kJSTypeNumber    */ "Number",
    /* kJSTypeString    */ "String",
    /* kJSTypeObject    */ "Object",
    /* kJSTypeSymbol    */ "Symbol",
    /* kJSTypeBigInt    */ "BigInt",
]);

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

pub const FETCH_TYPE_ERROR_STRINGS: JSTypeErrorEnum = EnumMap::from_array([
    FETCH_TYPE_ERROR_STRING_VALUES[0],
    FETCH_TYPE_ERROR_STRING_VALUES[1],
    FETCH_TYPE_ERROR_STRING_VALUES[2],
    FETCH_TYPE_ERROR_STRING_VALUES[3],
    FETCH_TYPE_ERROR_STRING_VALUES[4],
    FETCH_TYPE_ERROR_STRING_VALUES[5],
    FETCH_TYPE_ERROR_STRING_VALUES[6],
    FETCH_TYPE_ERROR_STRING_VALUES[7],
]);

// ──────────────────────────────────────────────────────────────────────────
// Re-export: FetchTasklet lives in ./fetch/FetchTasklet.zig
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): module wiring — fetch.rs + fetch/ subdir (Rust 2018 path). Phase B.
pub mod fetch_tasklet;
pub use fetch_tasklet::FetchTasklet;
use fetch_tasklet::HTTPRequestBody;

// ──────────────────────────────────────────────────────────────────────────
// dataURLResponse
// ──────────────────────────────────────────────────────────────────────────

fn data_url_response(data_url_: DataURL, global_this: &JSGlobalObject) -> JSValue {
    let mut data_url = data_url_;

    let data = match data_url.decode_data() {
        Ok(d) => d,
        Err(_) => {
            let err = global_this.create_error("failed to fetch the data URL");
            return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                err,
            );
        }
    };
    let mut blob = Blob::init(data, global_this);

    let mut allocated = false;
    let mime_type = MimeType::init(data_url.mime_type, &mut allocated);
    blob.content_type = mime_type.value;
    if allocated {
        blob.content_type_allocated = true;
    }

    let response = Box::new(Response::init(
        Response::Init {
            status_code: 200,
            status_text: BunString::create_atom_ascii("OK"),
            ..Default::default()
        },
        Body {
            value: Body::Value::Blob(blob),
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
    let arguments = callframe.arguments_old(1).slice();

    if arguments.len() < 1 {
        return global_object.throw_not_enough_arguments("fetch.preconnect", 1, arguments.len());
    }

    let url_str = jsc::URL::href_from_js(arguments[0], global_object)?;
    // PORT NOTE: `defer url_str.deref()` → BunString impls Drop.

    if global_object.has_exception() {
        return Ok(JSValue::ZERO);
    }

    if url_str.tag() == BunString::Tag::Dead {
        return global_object
            .err(jsc::ErrorCode::INVALID_ARG_TYPE, "Invalid URL")
            .throw();
    }

    if url_str.is_empty() {
        return global_object
            .err(jsc::ErrorCode::INVALID_ARG_TYPE, FETCH_ERROR_BLANK_URL)
            .throw();
    }

    // PORT NOTE: bun.handleOom(url_str.toOwnedSlice(...)) → to_owned_slice() aborts on OOM.
    let href = url_str.to_owned_slice();
    let url = ZigURL::parse(&href);
    if !url.is_http() && !url.is_https() && !url.is_s3() {
        drop(href);
        return global_object.throw_invalid_arguments("URL must be HTTP or HTTPS");
    }

    if url.hostname.is_empty() {
        drop(href);
        return global_object
            .err(jsc::ErrorCode::INVALID_ARG_TYPE, FETCH_ERROR_BLANK_URL)
            .throw();
    }

    if !url.has_valid_port() {
        drop(href);
        return global_object.throw_invalid_arguments("Invalid port");
    }

    // TODO(port): lifetime — `url` borrows `href`; preconnect(url, true) takes ownership of href.
    http::AsyncHTTP::preconnect(url, true);
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
        if out.tag() == BunString::Tag::Dead {
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
    jsc::mark_binding(core::panic::Location::caller());
    let global_this = ctx;
    let arguments = callframe.arguments_old(2);
    bun_core::analytics::Features::fetch_inc();
    let vm = VirtualMachine::get();

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

    if arguments.len() == 0 {
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

    let mut args = jsc::CallFrame::ArgumentsSlice::init(vm, arguments.slice());

    let mut url = ZigURL::default();
    let first_arg = args.next_eat().unwrap();

    // We must always get the Body before the Headers That way, we can set
    // the Content-Type header from the Blob if no Content-Type header is
    // set in the Headers
    //
    // which is important for FormData.
    // https://github.com/oven-sh/bun/issues/2264
    //
    let mut body: HTTPRequestBody = HTTPRequestBody::Empty;

    let mut disable_timeout = false;
    let mut disable_keepalive = false;
    let mut disable_decompression = false;
    let mut verbose: http::HTTPVerboseLevel = if vm.log.level.at_least(bun_logger::Level::Debug) {
        http::HTTPVerboseLevel::Headers
    } else {
        http::HTTPVerboseLevel::None
    };
    if verbose == http::HTTPVerboseLevel::None {
        verbose = vm.get_verbose_fetch();
    }

    let mut proxy: Option<ZigURL> = None;
    let mut redirect_type: FetchRedirect = FetchRedirect::Follow;
    // TODO(port): lifetime — AbortSignal is intrusive-refcounted; ref()/unref() are
    // manual. Model as Option<NonNull<AbortSignal>> with a Drop guard in Phase B.
    let mut signal: Option<NonNull<AbortSignal>> = None;
    // Custom Hostname
    let mut hostname: Option<Box<[u8]>> = None;
    let mut range: Option<Box<[u8]>> = None;
    let mut unix_socket_path: ZigString::Slice = ZigString::Slice::empty();

    // TODO(port): lifetime — `url` and `proxy` borrow into this buffer. Kept as
    // Vec<u8> (owned) here; ZigURL fields are raw slices in Phase A.
    let mut url_proxy_buffer: Vec<u8> = Vec::new();
    let mut url_type = URLType::Remote;

    let mut ssl_config: Option<SSLConfig::SharedPtr> = None;
    let mut reject_unauthorized = vm.get_tls_reject_unauthorized();
    let mut check_server_identity: JSValue = JSValue::ZERO;

    // PORT NOTE: the Zig `defer { ... }` block here freed signal/unix_socket_path/
    // url_proxy_buffer/headers/body/hostname/range/ssl_config on every exit path.
    // In Rust, all of these are owning types whose Drop runs on early return.
    // The explicit `signal.unref()` is the only side-effect not covered by Drop:
    let _signal_guard = scopeguard::guard((), |_| {
        if let Some(sig) = signal {
            // SAFETY: sig was obtained via .ref() below; matched unref() here.
            unsafe { sig.as_ref().unref() };
        }
    });
    // TODO(port): errdefer — `_signal_guard` captures `signal` by ref across many
    // mutations; verify borrowck in Phase B (may need Cell/RefCell).

    let options_object: Option<JSValue> = 'brk: {
        if let Some(options) = args.next_eat() {
            if options.is_object() || options.js_type() == jsc::JSType::DOMWrapper {
                break 'brk Some(options);
            }
        }
        break 'brk None;
    };

    let request: Option<&mut Request> = 'brk: {
        if first_arg.is_cell() {
            if let Some(request_) = first_arg.as_direct::<Request>() {
                break 'brk Some(request_);
            }
        }
        break 'brk None;
    };

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

        if let Some(req) = request.as_deref_mut() {
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
                let err = ctx.create_error("failed to fetch the data URL");
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

    url = match ZigURL::from_string(&url_str) {
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
    if url.is_file() {
        url_type = URLType::File;
    } else if url.is_blob() {
        url_type = URLType::Blob;
    }
    // TODO(port): lifetime — url.href is owned by ZigURL::from_string; we move
    // ownership into url_proxy_buffer here while url's slices still point into it.
    url_proxy_buffer = url.href.to_vec();

    // **Start with the harmless ones.**

    // "method"
    method = 'extract_method: {
        if let Some(options) = options_object {
            if let Some(method_) = options.get_truthy_comptime(global_this, "method")? {
                break 'extract_method Some(Method::from_js(global_this, method_)?);
            }
        }

        if let Some(req) = request.as_deref() {
            break 'extract_method Some(req.method);
        }

        if let Some(req) = request_init_object {
            if let Some(method_) = req.get_truthy_comptime(global_this, "method")? {
                break 'extract_method Some(Method::from_js(global_this, method_)?);
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
                        break 'extract_disable_decompression decompression_value.to::<i32>() == 0;
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
                                reject_unauthorized = reject.to::<i32>() != 0;
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
                                    SSLConfig::GlobalRegistry::intern(config),
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
                        break 'extract_unix_socket_path socket_path
                            .to_slice_clone_with_allocator(global_this)?;
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
                            return global_this.throw_invalid_arguments(
                                "fetch: 'protocol' must be \"http2\", \"h2\", \"http3\", \"h3\", \"http1.1\", or \"h1\"",
                            );
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
                        break 'extract_disable_timeout timeout_value.to::<i32>() == 0;
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
        if let Some(req) = request.as_deref() {
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
                        break 'extract_disable_keepalive keepalive_value.to::<i32>() == 0;
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
                        if href.tag() == BunString::Tag::Dead {
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
                        url = ZigURL::parse(&buffer[0..url_len]);
                        if url.is_file() {
                            url_type = URLType::File;
                        } else if url.is_blob() {
                            url_type = URLType::Blob;
                        }

                        proxy = Some(ZigURL::parse(&buffer[url_len..]));
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
                                    if href.tag() == BunString::Tag::Dead {
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
                                    url = ZigURL::parse(&buffer[0..url_len]);
                                    if url.is_file() {
                                        url_type = URLType::File;
                                    } else if url.is_blob() {
                                        url_type = URLType::Blob;
                                    }

                                    proxy = Some(ZigURL::parse(&buffer[url_len..]));
                                    // PORT NOTE: allocator.free(url_proxy_buffer) — old Vec dropped on reassign.
                                    url_proxy_buffer = buffer;

                                    // Get the headers from the proxy object (optional)
                                    if let Some(headers_value) =
                                        proxy_arg.get(global_this, "headers")?
                                    {
                                        if !headers_value.is_undefined_or_null() {
                                            if let Some(fetch_hdrs) =
                                                headers_value.as_::<FetchHeaders>()
                                            {
                                                proxy_headers = Some(Headers::from(
                                                    Some(fetch_hdrs),
                                                    Headers::Options::default(),
                                                ));
                                            } else if let Some(fetch_hdrs) =
                                                FetchHeaders::create_from_js(ctx, headers_value)?
                                            {
                                                // PORT NOTE: `defer fetch_hdrs.deref()` → Drop guard.
                                                let _g = scopeguard::guard((), |_| {
                                                    fetch_hdrs.deref()
                                                });
                                                proxy_headers = Some(Headers::from(
                                                    Some(fetch_hdrs),
                                                    Headers::Options::default(),
                                                ));
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
                    if let Some(signal__) = signal_.as_::<AbortSignal>() {
                        break 'extract_signal Some(signal__.ref_());
                    }
                }
            }

            if global_this.has_exception() {
                is_error = true;
                return Ok(JSValue::ZERO);
            }
        }

        if let Some(req) = request.as_deref() {
            if let Some(signal_) = req.signal {
                break 'extract_signal Some(signal_.ref_());
            }
            break 'extract_signal None;
        }

        if let Some(options) = request_init_object {
            if let Some(signal_) = options.get(global_this, "signal")? {
                if signal_.is_undefined() {
                    break 'extract_signal None;
                }

                if let Some(signal__) = signal_.as_::<AbortSignal>() {
                    break 'extract_signal Some(signal__.ref_());
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

        if let Some(req) = request.as_deref_mut() {
            let body_value = req.get_body_value();
            if matches!(*body_value, Body::Value::Used)
                || (matches!(*body_value, Body::Value::Locked(_))
                    && (body_value.locked().action != Body::Value::Locked::Action::None
                        || body_value
                            .locked()
                            .is_disturbed::<Request>(global_this, first_arg)))
            {
                return global_this
                    .err(jsc::ErrorCode::BODY_ALREADY_USED, "Request body already used")
                    .throw();
            }

            if matches!(*body_value, Body::Value::Locked(_)) {
                if let Some(readable) = req.get_body_readable_stream(global_this) {
                    break 'extract_body Some(HTTPRequestBody::ReadableStream(
                        ReadableStream::Strong::init(readable, global_this),
                    ));
                }
                if body_value.locked().readable.has() {
                    break 'extract_body Some(HTTPRequestBody::ReadableStream(
                        ReadableStream::Strong::init(
                            body_value.locked().readable.get(global_this).unwrap(),
                            global_this,
                        ),
                    ));
                }
                let readable = body_value.to_readable_stream(global_this)?;
                if !readable.is_empty_or_undefined_or_null()
                    && matches!(*body_value, Body::Value::Locked(_))
                    && body_value.locked().readable.has()
                {
                    break 'extract_body Some(HTTPRequestBody::ReadableStream(
                        ReadableStream::Strong::init(
                            body_value.locked().readable.get(global_this).unwrap(),
                            global_this,
                        ),
                    ));
                }
            }

            break 'extract_body Some(HTTPRequestBody::AnyBlob(body_value.use_as_any_blob()));
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
    .unwrap_or(HTTPRequestBody::Empty);

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    // headers: Headers | undefined;
    headers = 'extract_headers: {
        let mut fetch_headers_to_deref: Option<*mut FetchHeaders> = None;
        let _deref_guard = scopeguard::guard((), |_| {
            if let Some(fetch_headers) = fetch_headers_to_deref {
                // SAFETY: fetch_headers was obtained from createFromJS below.
                unsafe { (*fetch_headers).deref() };
            }
        });
        // TODO(port): errdefer — guard captures fetch_headers_to_deref by ref; verify borrowck.

        let fetch_headers: Option<*mut FetchHeaders> = 'brk: {
            if let Some(options) = options_object {
                if let Some(headers_value) =
                    options.fast_get(global_this, jsc::BuiltinName::Headers)?
                {
                    if !headers_value.is_undefined() {
                        if let Some(headers__) = headers_value.as_::<FetchHeaders>() {
                            if headers__.is_empty() {
                                break 'brk None;
                            }
                            break 'brk Some(headers__);
                        }

                        if let Some(headers__) = FetchHeaders::create_from_js(ctx, headers_value)?
                        {
                            fetch_headers_to_deref = Some(headers__);
                            break 'brk Some(headers__);
                        }

                        break 'brk None;
                    }
                }

                if global_this.has_exception() {
                    is_error = true;
                    return Ok(JSValue::ZERO);
                }
            }

            if let Some(req) = request.as_deref() {
                if let Some(head) = req.get_fetch_headers_unless_empty() {
                    break 'brk Some(head);
                }
                break 'brk None;
            }

            if let Some(options) = request_init_object {
                if let Some(headers_value) =
                    options.fast_get(global_this, jsc::BuiltinName::Headers)?
                {
                    if !headers_value.is_undefined() {
                        if let Some(headers__) = headers_value.as_::<FetchHeaders>() {
                            if headers__.is_empty() {
                                break 'brk None;
                            }
                            break 'brk Some(headers__);
                        }

                        if let Some(headers__) = FetchHeaders::create_from_js(ctx, headers_value)?
                        {
                            fetch_headers_to_deref = Some(headers__);
                            break 'brk Some(headers__);
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

        if let Some(headers_) = fetch_headers {
            // SAFETY: headers_ points to a live FetchHeaders (either JS-owned or
            // refcounted via fetch_headers_to_deref guard above).
            let headers_ = unsafe { &*headers_ };
            if let Some(hostname_) = headers_.fast_get(FetchHeaders::HTTPHeaderName::Host) {
                hostname = Some(hostname_.to_owned_slice_z());
            }
            if url.is_s3() {
                if let Some(range_) = headers_.fast_get(FetchHeaders::HTTPHeaderName::Range) {
                    range = Some(range_.to_owned_slice_z());
                }
            }

            if let Some(upgrade_) = headers_.fast_get(FetchHeaders::HTTPHeaderName::Upgrade) {
                let upgrade = upgrade_.to_slice();
                // PORT NOTE: `defer upgrade.deinit()` → Drop.
                let slice = upgrade.slice();
                if slice != b"h2" && slice != b"h2c" {
                    upgraded_connection = true;
                }
            }

            break 'extract_headers Some(Headers::from(
                Some(headers_),
                Headers::Options {
                    body: body.get_any_blob(),
                },
            ));
        }

        break 'extract_headers headers;
    };

    if global_this.has_exception() {
        is_error = true;
        return Ok(JSValue::ZERO);
    }

    if proxy.is_some() && unix_socket_path.length() > 0 {
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
                return global_this.throw_error(err, "Failed to decode file url");
            }
        };
        let mut url_path_decoded = &path_buf2[0..decoded_len];

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
                let cwd = global_this.bun_vm().transpiler.fs.top_level_dir;

                let fullpath = bun_paths::join_abs_string_buf(
                    cwd,
                    &mut path_buf,
                    &[global_this.bun_vm().main, b"../", url_path_decoded],
                    bun_paths::Platform::Auto,
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

            let mut pathlike = node::PathOrFileDescriptor::Path(node::PathLike {
                encoded_slice: ZigString::Slice::init(
                    Box::<[u8]>::from(temp_file_path),
                ),
            });

            break 'blob Blob::find_or_create_file_from_path(&mut pathlike, global_this, true);
        };

        let response = Box::new(Response::init(
            Response::Init {
                status_code: 200,
                ..Default::default()
            },
            Body {
                value: Body::Value::Blob(blob_to_use),
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
            Headers::Options {
                body: body.get_any_blob(),
            },
        ));
    }

    let mut http_body = body.clone_ref();
    // TODO(port): `http_body = body` in Zig is a shallow struct copy; here we
    // model HTTPRequestBody as move-only — clone_ref() bumps refcounts where needed.

    if body.is_s3() {
        'prepare_body: {
            // is a S3 file we can use chunked here

            if let Some(stream) = ReadableStream::from_js(
                ReadableStream::from_blob_copy_ref(
                    global_this,
                    body.any_blob().blob(),
                    s3::MultiPartUploadOptions::DEFAULT_PART_SIZE,
                )?,
                global_this,
            )? {
                let old = core::mem::replace(
                    &mut body,
                    HTTPRequestBody::ReadableStream(ReadableStream::Strong::init(
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
            let opened_fd_res: bun_sys::Result<bun_sys::Fd> =
                match &body.store().unwrap().data.file.pathlike {
                    node::PathOrFileDescriptor::Fd(fd) => bun_sys::dup(*fd),
                    node::PathOrFileDescriptor::Path(path) => bun_sys::open(
                        path.slice_z(&mut global_this.bun_vm().node_fs().sync_error_buf),
                        if cfg!(windows) {
                            bun_sys::O::RDONLY
                        } else {
                            bun_sys::O::RDONLY | bun_sys::O::NOCTTY
                        },
                        0,
                    ),
                };

            let opened_fd = match opened_fd_res {
                Err(err) => {
                    let err_js = match err.to_js(global_this) {
                        Ok(v) => v,
                        Err(_) => return Ok(JSValue::ZERO),
                    };
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
                        if !bun_sys::is_regular_file(stat.mode) {
                            break 'use_sendfile;
                        }
                    }

                    // if it's < 32 KB, it's not worth it
                    if stat.size < 32 * 1024 {
                        break 'use_sendfile;
                    }

                    let original_size = body.any_blob().blob().size;
                    let stat_size = Blob::SizeType::try_from(stat.size).unwrap();
                    let blob_size = if bun_sys::is_regular_file(stat.mode) {
                        stat_size
                    } else {
                        original_size.min(stat_size)
                    };

                    http_body = HTTPRequestBody::Sendfile(http::SendFile {
                        fd: opened_fd,
                        remain: body.any_blob().blob().offset + original_size,
                        offset: body.any_blob().blob().offset,
                        content_size: blob_size,
                    });

                    if bun_sys::is_regular_file(stat.mode) {
                        let sf = http_body.sendfile_mut();
                        sf.offset = sf.offset.min(stat_size);
                        sf.remain = sf
                            .remain
                            .max(sf.offset)
                            .min(stat_size)
                            .saturating_sub(sf.offset);
                    }
                    body.detach();

                    break 'prepare_body;
                }
            }

            // TODO: make this async + lazy
            let res = node::fs::NodeFS::read_file(
                global_this.bun_vm().node_fs(),
                node::fs::ReadFileArgs {
                    encoding: node::Encoding::Buffer,
                    path: node::PathOrFileDescriptor::Fd(opened_fd),
                    offset: body.any_blob().blob().offset,
                    max_size: body.any_blob().blob().size,
                    ..Default::default()
                },
                node::fs::Flavor::Sync,
            );

            if matches!(
                body.store().unwrap().data.file.pathlike,
                node::PathOrFileDescriptor::Path(_)
            ) {
                opened_fd.close();
            }

            match res {
                Err(err) => {
                    is_error = true;
                    let err_js = match err.to_js(global_this) {
                        Ok(v) => v,
                        Err(_) => return Ok(JSValue::ZERO),
                    };
                    let rejected_value =
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err_js,
                        );
                    body.detach();
                    return Ok(rejected_value);
                }
                Ok(result) => {
                    body.detach();
                    // TODO(port): @constCast(result.slice()) — taking ownership of buffer
                    body = HTTPRequestBody::AnyBlob(Blob::Any::from_owned_slice(
                        result.into_owned_slice(),
                    ));
                    http_body = HTTPRequestBody::AnyBlob(body.any_blob().clone());
                }
            }
        }
    }

    if url.is_s3() {
        // get ENV config
        let mut credentials_with_options = s3::S3CredentialsWithOptions {
            credentials: global_this.bun_vm().transpiler.env.get_s3_credentials(),
            options: Default::default(),
            acl: None,
            storage_class: None,
            ..Default::default()
        };
        // PORT NOTE: `defer credentialsWithOptions.deinit()` → Drop.

        if let Some(options) = options_object {
            if let Some(s3_options) = options.get_truthy_comptime(global_this, "s3")? {
                if s3_options.is_object() {
                    s3_options.ensure_still_alive();
                    credentials_with_options = s3::S3Credentials::get_credentials_with_options(
                        credentials_with_options.credentials,
                        Default::default(),
                        s3_options,
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
            let promise = JSPromise::Strong::init(global_this);

            let s3_stream = Box::new(S3StreamWrapper {
                url,
                url_proxy_buffer: url_proxy_buffer.into_boxed_slice(),
                promise: promise.clone_ref(),
                global: global_this,
            });

            let promise_value = promise.value();
            let proxy_url: &[u8] = match &proxy {
                Some(p) => p.href,
                None => b"",
            };
            let _ = s3::upload_stream(
                credentials_with_options.credentials.dupe(),
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
                // SAFETY: @ptrCast(&Wrapper.resolve) — fn pointer cast to opaque callback.
                S3StreamWrapper::resolve as *const _,
                Box::into_raw(s3_stream),
            )?;
            // PORT NOTE: url/url_proxy_buffer ownership moved into s3_stream above.
            url = ZigURL::default();
            url_proxy_buffer = Vec::new();
            return Ok(promise_value);
        }
        if method == Method::POST {
            method = Method::PUT;
        }

        let mut result = match credentials_with_options.credentials.sign_request(
            s3::SignOptions {
                path: url.s3_path(),
                method,
                ..Default::default()
            },
            false,
            None,
        ) {
            Ok(r) => r,
            Err(sign_err) => {
                is_error = true;
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        s3::get_js_sign_error(sign_err, global_this),
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
            buffer[0..result.url.len()].copy_from_slice(result.url);
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
        let mut header_buffer: [picohttp::Header; s3::S3Credentials::SignResult::MAX_HEADERS + 1] =
            // SAFETY: header_buffer is fully written by mix_with_header / headers() before read.
            unsafe { core::mem::zeroed() };
        // TODO(port): std.mem.zeroes on picohttp.Header — verify all-zero is valid in Phase B.

        if let Some(range_) = &range {
            let new_headers = result.mix_with_header(
                &mut header_buffer,
                picohttp::Header {
                    name: b"range",
                    value: range_,
                },
            );
            set_headers(&mut headers, new_headers);
        } else if let Some(ct) = content_type {
            if !ct.is_empty() {
                let new_headers = result.mix_with_header(
                    &mut header_buffer,
                    picohttp::Header {
                        name: b"Content-Type",
                        value: ct,
                    },
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
    let promise = JSPromise::Strong::init(global_this);

    let promise_val = promise.value();

    #[cfg(debug_assertions)]
    let initial_body_reference_count: usize = {
        if let Some(store) = body.store() {
            store.ref_count.load(core::sync::atomic::Ordering::Relaxed)
        } else {
            0
        }
    };

    let _ = FetchTasklet::queue(
        global_this,
        FetchTasklet::Options {
            method,
            url,
            headers: headers.take().unwrap_or_else(Headers::default),
            body: http_body,
            disable_keepalive,
            disable_timeout,
            disable_decompression,
            reject_unauthorized,
            redirect_type,
            verbose,
            proxy: proxy.take(),
            proxy_headers: proxy_headers.take(),
            url_proxy_buffer: core::mem::take(&mut url_proxy_buffer),
            signal: signal.take(),
            global_this,
            ssl_config: ssl_config.take(),
            hostname: hostname.take(),
            upgraded_connection,
            force_http2,
            force_http3,
            force_http1,
            check_server_identity: if check_server_identity.is_empty_or_undefined_or_null() {
                jsc::Strong::empty()
            } else {
                jsc::Strong::create(check_server_identity, global_this)
            },
            unix_socket_path: core::mem::replace(
                &mut unix_socket_path,
                ZigString::Slice::empty(),
            ),
        },
        // Pass the Strong value instead of creating a new one, or else we
        // will leak it
        // see https://github.com/oven-sh/bun/issues/2985
        promise,
    );
    // PORT NOTE: `catch |err| bun.handleOom(err)` — FetchTasklet::queue aborts on OOM.

    #[cfg(debug_assertions)]
    {
        if let Some(store) = body.store() {
            if store.ref_count.load(core::sync::atomic::Ordering::Relaxed)
                == initial_body_reference_count
            {
                Output::panic("Expected body ref count to have incremented in FetchTasklet");
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
        body = HTTPRequestBody::Empty;
    }

    Ok(promise_val)
}

// ──────────────────────────────────────────────────────────────────────────
// S3 ReadableStream upload Wrapper (was a fn-local struct in Zig)
// PORT NOTE: hoisted to module level — Rust does not allow `impl` blocks
// inside fn bodies for types referenced by external fn pointers.
// ──────────────────────────────────────────────────────────────────────────

struct S3StreamWrapper<'a> {
    promise: JSPromise::Strong,
    url: ZigURL,
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
        let self_ = unsafe { Box::from_raw(self_) };
        let global = self_.global;
        // PORT NOTE: `defer bun.destroy(self)` + `defer free(url_proxy_buffer)` →
        // Box<Self> and Box<[u8]> Drop at end of scope.
        match result {
            s3::S3UploadResult::Success => {
                let response = Box::new(Response::init(
                    Response::Init {
                        method: Method::PUT,
                        status_code: 200,
                        ..Default::default()
                    },
                    Body {
                        value: Body::Value::Empty,
                    },
                    BunString::create_atom_if_possible(self_.url.href),
                    false,
                ));
                let response_js = Response::make_maybe_pooled(global, response);
                response_js.ensure_still_alive();
                self_.promise.resolve(global, response_js)?;
            }
            s3::S3UploadResult::Failure(err) => {
                let response = Box::new(Response::init(
                    Response::Init {
                        method: Method::PUT,
                        status_code: 500,
                        status_text: BunString::create_atom_if_possible(err.code),
                        ..Default::default()
                    },
                    Body {
                        value: Body::Value::InternalBlob(Body::InternalBlob {
                            bytes: err.message.to_vec(),
                            was_string: true,
                        }),
                    },
                    BunString::create_atom_if_possible(self_.url.href),
                    false,
                ));

                let response_js = Response::make_maybe_pooled(global, response);
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/fetch.zig (1526 lines)
//   confidence: medium
//   todos:      13
//   notes:      url_proxy_buffer/ZigURL borrow relationship + big defer-cleanup → Drop-based ownership needs Phase B borrowck audit; S3 Wrapper hoisted to module level with <'a> per LIFETIMES.tsv; possible upstream bug at fetch.zig:1373 preserved verbatim
// ──────────────────────────────────────────────────────────────────────────
