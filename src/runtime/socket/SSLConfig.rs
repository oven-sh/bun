//! The JSC-dependent half of `bun_http::ssl_config`: parsing a `tls` object needs `bun_jsc`, `webcore::Blob` and `node_fs`.

use bun_core::SensitiveCString;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsError, JsResult, SysErrorJsc};

use crate::generated_bindgen::ssl_config as generated;
use crate::node::fs as node_fs;
use crate::webcore::Blob;
use crate::webcore::blob::store::Data as StoreData;

// ──────────────────────────────────────────────────────────────────────────
// Canonical re-exports (struct + registry live in bun_http now)
// ──────────────────────────────────────────────────────────────────────────

pub(crate) use bun_http::ssl_config::SSLConfig;

// ──────────────────────────────────────────────────────────────────────────
// ReadFromBlobError
// ──────────────────────────────────────────────────────────────────────────

// Cannot derive `thiserror::Error` because `JsError` is not
// `std::error::Error`/`Display`. Manual `From<JsError>` instead.
#[derive(Debug)]
pub(crate) enum ReadFromBlobError {
    Js(JsError),
    NullStore,
    NotAFile,
    EmptyFile,
}

impl From<JsError> for ReadFromBlobError {
    #[inline]
    fn from(e: JsError) -> Self {
        ReadFromBlobError::Js(e)
    }
}

type CStrSlice = Option<Box<[SensitiveCString]>>;

fn from_string(string: &bun_core::String) -> SensitiveCString {
    let mut utf8 = string.to_utf8();
    let copy = SensitiveCString::new(utf8.slice());
    if let bun_core::Utf8Bytes::Owned(transcoded) = &mut utf8 {
        bun_core::secure_zero(transcoded);
    }
    copy
}

fn read_from_blob(
    global: &JSGlobalObject,
    blob: &Blob,
) -> Result<SensitiveCString, ReadFromBlobError> {
    let store = blob
        .store
        .get()
        .as_ref()
        .ok_or(ReadFromBlobError::NullStore)?;
    let file = match &store.data {
        StoreData::File(f) => f,
        _ => return Err(ReadFromBlobError::NotAFile),
    };
    let mut fs = node_fs::NodeFS::default();
    let read_args = node_fs::args::ReadFile {
        path: file.pathlike.clone(),
        ..Default::default()
    };
    let maybe = fs.read_file_with_options(
        &read_args,
        node_fs::Flavor::Sync,
        node_fs::ReadFileStringType::NullTerminated,
    );
    let result = match maybe {
        Ok(result) => result,
        Err(err) => {
            return Err(global.throw_value(err.to_js(global)).into());
        }
    };
    let node_fs::ret::ReadFileWithOptions::NullTerminated(contents) = result else {
        unreachable!("ReadFileStringType::NullTerminated always yields the NullTerminated variant");
    };
    contents.ok_or(ReadFromBlobError::EmptyFile)
}

/// The protocol code for a `minVersion` / `maxVersion` option, 0 if it isn't set.
fn protocol_version(
    global: &JSGlobalObject,
    bound: &str,
    version: &generated::TLSVersion,
) -> JsResult<i32> {
    let name = match version {
        generated::TLSVersion::None => return Ok(0),
        generated::TLSVersion::Code(code) => return Ok(*code),
        generated::TLSVersion::Name(name) => name,
    };
    match protocol_version_code(name.to_utf8().slice()) {
        0 => Err(global
            .err(
                jsc::ErrorCode::TLS_INVALID_PROTOCOL_VERSION,
                format_args!("\"{name}\" is not a valid {bound} TLS protocol version"),
            )
            .throw()),
        code => Ok(code),
    }
}

pub(crate) fn protocol_version_code(name: &[u8]) -> i32 {
    match name {
        b"TLSv1" => 0x0301,
        b"TLSv1.1" => 0x0302,
        b"TLSv1.2" => 0x0303,
        b"TLSv1.3" => 0x0304,
        _ => 0,
    }
}

/// What a `tls` object asks for. `None` inside: it sets no option, like `tls: {}`, and each API decides if that still turns TLS on.
pub(crate) struct ParsedTls(Option<SSLConfig>);

impl ParsedTls {
    /// For an API where `tls: {}` means `tls: true`.
    pub(crate) fn or_defaults(self, vm: &VirtualMachine, is_server: bool) -> SSLConfig {
        self.0
            .unwrap_or_else(|| vm.tls_config(Default::default(), is_server))
    }

    /// For an API where `tls: {}` means no `tls`.
    pub(crate) fn or_none(self) -> Option<SSLConfig> {
        self.0
    }

    pub(crate) fn from_js(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        value: JSValue,
        is_server: bool,
    ) -> JsResult<Self> {
        let generated = generated::TLSOptions::from_js(global, value)?;
        Self::from_generated(vm, global, &generated, is_server)
    }

    pub(crate) fn from_generated(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        generated: &generated::TLSOptions,
        is_server: bool,
    ) -> JsResult<Self> {
        let given = Self::given(global, generated, is_server)?;
        Ok(Self(given.map(|given| vm.tls_config(given, is_server))))
    }

    /// The options without the defaults, for an owner that outlives a change of them.
    pub(crate) fn given(
        global: &JSGlobalObject,
        generated: &generated::TLSOptions,
        is_server: bool,
    ) -> JsResult<Option<bun_http::ssl_config::Builder>> {
        let path = |field, path: &Option<bun_core::String>| {
            (path.as_ref())
                .map(|path| handle_path(global, field, path))
                .transpose()
        };
        let mut result = bun_http::ssl_config::Builder::default();

        result.passphrase = generated.passphrase.as_ref().map(from_string);
        result.dh_params_file_name = path("dhParamsFile", &generated.dh_params_file)?;
        if let Some(server_name) = &generated.server_name {
            let server_name = server_name.to_utf8();
            // `server_name` is a C string: SNI and the certificate check would see the name up to the NUL.
            if bun_core::strings::contains_char(server_name.slice(), 0) {
                return Err(global.throw_invalid_arguments(format_args!(
                    "\"serverName\" must not contain null bytes"
                )));
            }
            result.server_name = Some(SensitiveCString::new(server_name.slice()));
        }

        result.low_memory_mode = generated.low_memory_mode;
        result.reject_unauthorized = generated.reject_unauthorized;
        result.request_cert = generated.request_cert as i32;
        result.secure_options = generated.secure_options;
        result.ssl_min_version = protocol_version(global, "minimum", &generated.ssl_min_version)?;
        result.ssl_max_version = protocol_version(global, "maximum", &generated.ssl_max_version)?;
        result.session_timeout = generated.session_timeout;
        result.allow_partial_trust_chain = generated.allow_partial_trust_chain;
        result.sigalgs = generated.sigalgs.as_ref().map(from_string);
        // `ecdhCurve: 'auto'`, Node's default, means the library's default group list.
        result.ecdh_curve = generated.ecdh_curve.as_ref().and_then(|ecdh_curve| {
            let bytes = ecdh_curve.to_utf8();
            (bytes.slice() != b"auto").then(|| SensitiveCString::new(bytes.slice()))
        });

        result.ca = handle_file_for_field(global, "ca", &generated.ca)?;
        result.ca_is_empty =
            matches!(&generated.ca, generated::TLSOptionsFile::Array(list) if list.is_empty());
        result.cert = handle_file_for_field(global, "cert", &generated.cert)?;
        result.key = handle_file_for_field(global, "key", &generated.key)?;
        result.crl = handle_file_for_field(global, "crl", &generated.crl)?;
        result.key_file_name = path("keyFile", &generated.key_file)?;
        result.cert_file_name = path("certFile", &generated.cert_file)?;
        result.ca_file_name = path("caFile", &generated.ca_file)?;

        result.protos = match &generated.alpn_protocols {
            generated::ALPNProtocols::None => None,
            generated::ALPNProtocols::String(val) => Some(from_string(val)),
            generated::ALPNProtocols::Buffer(val) => {
                Some(SensitiveCString::new(val.as_array_buffer().byte_slice()))
            }
        };
        result.ssl_ciphers = generated.ciphers.as_ref().map(from_string);
        result.client_renegotiation_limit = generated.client_renegotiation_limit;
        result.client_renegotiation_window = generated.client_renegotiation_window;

        result.requires_custom_request_ctx = result.server_name.is_some()
            || result.ca.is_some()
            || result.cert.is_some()
            || result.key.is_some()
            || result.crl.is_some()
            || result.secure_options != 0
            || result.ssl_min_version != 0
            || result.ssl_max_version != 0
            || result.sigalgs.is_some()
            || result.ecdh_curve.is_some()
            || result.session_timeout != 0
            || result.allow_partial_trust_chain
            || result.key_file_name.is_some()
            || result.cert_file_name.is_some()
            || result.ca_file_name.is_some()
            || result.protos.is_some()
            || result.ssl_ciphers.is_some();
        let any = result.requires_custom_request_ctx
            || result.passphrase.is_some()
            || result.dh_params_file_name.is_some()
            || result.low_memory_mode
            || result.reject_unauthorized.is_some()
            || generated.request_cert
            // It doesn't turn a server's TLS on.
            || (result.ca_is_empty && !is_server)
            || result.client_renegotiation_limit != 0
            || result.client_renegotiation_window != 0;

        Ok(any.then_some(result))
    }
}

/// For a request without TLS options: its default context is built on the HTTP thread, which sees neither `tls.DEFAULT_CIPHERS` nor `tls.setDefaultCACertificates`.
pub(crate) fn http_client_defaults(vm: &VirtualMachine) -> Option<bun_http::ssl_config::SharedPtr> {
    if !vm.tls_client_defaults_set() {
        return None;
    }
    // `NODE_TLS_REJECT_UNAUTHORIZED` can change between requests.
    let reject_unauthorized = vm.get_tls_reject_unauthorized() as i32;
    let cached = vm.rare_data().http_client_tls_defaults.get().clone();
    if let Some(config) = cached.filter(|config| config.reject_unauthorized == reject_unauthorized)
    {
        return Some(config);
    }
    let config =
        bun_http::ssl_config::global_registry::intern(vm.tls_config(Default::default(), false));
    vm.rare_data()
        .http_client_tls_defaults
        .set(Some(config.clone()));
    Some(config)
}

/// Whether a new TLS socket must enforce `rejectUnauthorized`: close the
/// connection when the peer certificate fails verification.
pub(crate) fn resolve_reject_unauthorized(
    vm: &VirtualMachine,
    cfg: Option<&SSLConfig>,
    is_server: bool,
) -> bool {
    match cfg {
        Some(cfg) => (!is_server || cfg.request_cert != 0) && cfg.reject_unauthorized != 0,
        None => !is_server && vm.get_tls_reject_unauthorized(),
    }
}

// ── handlePath / handleFile helpers ──────────────────────────────────

// `field` is a runtime &'static str (not monomorphized) since it is only
// used in a cold error message.
fn handle_path(
    global: &JSGlobalObject,
    field: &'static str,
    string: &bun_core::String,
) -> JsResult<SensitiveCString> {
    let name = string.to_utf8();
    let name = name.slice();
    if bun_core::strings::contains_char(name, 0) {
        return Err(global
            .err(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!("TLSOptions.{field} must be a path without null bytes"),
            )
            .throw());
    }
    // Opened later (for fetch, on the HTTP thread), and the SSL_CTX caches key on this string.
    let mut path = if cfg!(windows) || !bun_paths::is_absolute_posix(name) {
        bun_paths::AutoAbsPathChecked::init_top_level_dir()
    } else {
        bun_paths::AutoAbsPathChecked::init()
    };
    // The kernel resolves `..` through symlinks, so it is left in. Win32 resolves it as `join` does, which also knows `C:foo` and `\foo`.
    let pinned = if cfg!(windows) {
        path.join(&[name])
    } else {
        path.append(name)
    };
    // `append` drops a trailing slash, with which no file opens.
    if name.is_empty()
        || (cfg!(not(windows)) && name.ends_with(b"/"))
        || pinned.is_err()
        || bun_sys::access(path.slice_z(), bun_sys::posix::F_OK).is_err()
    {
        return Err(global.throw_invalid_arguments(format_args!("Unable to access {field} path")));
    }
    // BoringSSL's fopen is narrow on Windows: a non-ASCII cwd must not be baked into the path.
    if cfg!(windows) && !bun_core::strings::is_all_ascii(path.slice()) {
        return Ok(SensitiveCString::new(name));
    }
    Ok(SensitiveCString::new(path.slice()))
}

fn handle_file_for_field(
    global: &JSGlobalObject,
    field: &'static str,
    file: &generated::TLSOptionsFile,
) -> JsResult<CStrSlice> {
    match handle_file(global, file) {
        Ok(v) => Ok(v),
        Err(ReadFromBlobError::Js(e)) => Err(e),
        Err(ReadFromBlobError::EmptyFile) => {
            Err(global
                .throw_invalid_arguments(format_args!("TLSOptions.{} is an empty file", field)))
        }
        Err(ReadFromBlobError::NullStore) | Err(ReadFromBlobError::NotAFile) => Err(global
            .throw_invalid_arguments(format_args!(
                "TLSOptions.{} is not a valid BunFile (non-BunFile `Blob`s are not supported)",
                field
            ))),
    }
}

fn handle_file(
    global: &JSGlobalObject,
    file: &generated::TLSOptionsFile,
) -> Result<CStrSlice, ReadFromBlobError> {
    let single = handle_single_file(
        global,
        match file {
            generated::TLSOptionsFile::None => return Ok(None),
            generated::TLSOptionsFile::String(val) => SingleFile::String(val),
            generated::TLSOptionsFile::Buffer(val) => SingleFile::Buffer(val),
            generated::TLSOptionsFile::File(val) => SingleFile::File(val),
            generated::TLSOptionsFile::Array(list) => {
                return handle_file_array(global, list);
            }
        },
    )?;
    Ok(Some(vec![single].into_boxed_slice()))
}

fn handle_file_array(
    global: &JSGlobalObject,
    elements: &[generated::TLSOptionsSingleFile],
) -> Result<CStrSlice, ReadFromBlobError> {
    if elements.is_empty() {
        return Ok(None);
    }
    let mut result = Vec::with_capacity(elements.len());
    for elem in elements {
        result.push(handle_single_file(
            global,
            match elem {
                generated::TLSOptionsSingleFile::String(val) => SingleFile::String(val),
                generated::TLSOptionsSingleFile::Buffer(val) => SingleFile::Buffer(val),
                generated::TLSOptionsSingleFile::File(val) => SingleFile::File(val),
            },
        )?);
    }
    Ok(Some(result.into_boxed_slice()))
}

#[derive(Clone, Copy)]
enum SingleFile<'a> {
    String(&'a bun_core::String),
    Buffer(&'a jsc::JSCArrayBuffer),
    File(&'a crate::webcore::Blob),
}

fn handle_single_file(
    global: &JSGlobalObject,
    file: SingleFile<'_>,
) -> Result<SensitiveCString, ReadFromBlobError> {
    match file {
        SingleFile::String(string) => Ok(from_string(string)),
        SingleFile::Buffer(jsc_buffer) => {
            let buffer: jsc::ArrayBuffer = jsc_buffer.as_array_buffer();
            Ok(SensitiveCString::new(buffer.byte_slice()))
        }
        SingleFile::File(blob) => read_from_blob(global, blob),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WebSocket C-ABI exports (parseSSLConfig / freeSSLConfig)
//
// LAYERING: the consumer is `src/http_jsc/websocket_client/
// WebSocketUpgradeClient.rs`, but `ParsedTls::from_js`
// dereferences Blob / JSCArrayBuffer / node_fs values (tier-6) and lives in
// this crate. `bun_runtime → bun_http_jsc`, so hosting the export here breaks
// the cycle without an opaque stub. The boxed payload is the canonical
// `bun_http::ssl_config::SSLConfig` (what `HTTPClient::connect` consumes).
// C++ (JSWebSocket.cpp) links by symbol name only.
// ──────────────────────────────────────────────────────────────────────────

/// Parse SSLConfig from a JavaScript TLS options object.
/// This function is exported for C++ to call from JSWebSocket.cpp.
/// Returns null if parsing fails (an exception will be set on globalThis).
/// The returned SSLConfig is heap-allocated and ownership is transferred to the caller.
#[unsafe(no_mangle)]
extern "C" fn Bun__WebSocket__parseSSLConfig(
    global_this: &JSGlobalObject,
    tls_value: JSValue,
) -> Option<Box<bun_http::ssl_config::SSLConfig>> {
    // SAFETY: `bun_vm()` returns the live VM for this global; the WebSocket
    // constructor only runs on the JS thread with an initialized VM.
    let vm = global_this.bun_vm();
    // On `Err` the exception is already set on `global_this`. `tls: {}` is a WebSocket without TLS options.
    let config = ParsedTls::from_js(vm, global_this, tls_value, false).ok()?;
    config.or_none().map(Box::new)
}

/// Free an SSLConfig previously returned by `parseSSLConfig`.
/// Exported for C++ so error/early-return paths in JSWebSocket.cpp and
/// WebSocket.cpp can release ownership without leaking the heap allocation
/// (and all duped cert/key/CA strings inside it) when `connect()` never
/// hands the pointer off to an upgrade client.
#[unsafe(no_mangle)]
extern "C" fn Bun__WebSocket__freeSSLConfig(_: Option<Box<bun_http::ssl_config::SSLConfig>>) {}
