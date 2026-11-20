//! DEDUP(D202): the `SSLConfig` struct, its `Clone`/`Drop`/`Default`/hash/
//! equality/registry impls, and `as_usockets*`/`for_client_verification` were
//! duplicated (here and in `bun_http::ssl_config`). The lower-tier
//! `bun_http` copy is canonical (JSC-free, nullable NUL-terminated C-string
//! field layout); this module now re-exports it and keeps ONLY the
//! JSC-dependent constructors (`from_js` / `from_generated` / blob+path
//! readers) plus the WebSocket C-ABI exports, which need `bun_jsc` /
//! `webcore::Blob` / `node_fs` (tier-6).
//!
//! `from_js`/`from_generated` cannot be inherent `impl SSLConfig` (orphan
//! rule on a foreign type), so they're provided via the [`SSLConfigFromJs`]
//! extension trait. Import that trait to call `SSLConfig::from_js(..)`.

use std::sync::Arc;

use bun_collections::smallvec::SmallVec;
use bun_core::SensitiveCString;
use bun_http::ca_list::CaList;
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

// ──────────────────────────────────────────────────────────────────────────
// fromJS / fromGenerated — extension trait (orphan-rule workaround)
// ──────────────────────────────────────────────────────────────────────────

/// JSC-dependent constructors for the canonical `bun_http::SSLConfig`.
/// Import this trait to call `SSLConfig::from_js(..)` / `::from_generated(..)`.
/// An unset `rejectUnauthorized` is `true` for a server and `NODE_TLS_REJECT_UNAUTHORIZED` for a client, as in Node.js.
pub(crate) trait SSLConfigFromJs: Sized {
    fn from_js(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        value: JSValue,
        is_server: bool,
    ) -> JsResult<Option<Self>>;

    fn from_generated(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        generated: &generated::TLSOptions,
        is_server: bool,
    ) -> JsResult<Option<Self>>;
}

impl SSLConfigFromJs for SSLConfig {
    fn from_js(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        value: JSValue,
        is_server: bool,
    ) -> JsResult<Option<SSLConfig>> {
        let generated = generated::TLSOptions::from_js(global, value)?;
        Self::from_generated(vm, global, &generated, is_server)
    }

    fn from_generated(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        generated: &generated::TLSOptions,
        is_server: bool,
    ) -> JsResult<Option<SSLConfig>> {
        let path = |field, path: &Option<bun_core::String>| {
            (path.as_ref())
                .map(|path| handle_path(global, field, path))
                .transpose()
        };

        let passphrase = generated.passphrase.as_ref().map(from_string);
        let dh_params_file_name = path("dhParamsFile", &generated.dh_params_file)?;
        let server_name = match &generated.server_name {
            Some(server_name) => {
                let server_name = server_name.to_utf8();
                // `server_name` is a C string: SNI and the certificate check would see the name up to the NUL.
                if bun_core::strings::contains_char(server_name.slice(), 0) {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "\"serverName\" must not contain null bytes"
                    )));
                }
                Some(SensitiveCString::new(server_name.slice()))
            }
            None => None,
        };
        let reject_unauthorized = generated
            .reject_unauthorized
            .unwrap_or_else(|| is_server || vm.get_tls_reject_unauthorized());
        let sigalgs = generated.sigalgs.as_ref().map(from_string);
        // `ecdhCurve: 'auto'`, Node's default, means the library's default group list.
        let ecdh_curve = generated.ecdh_curve.as_ref().and_then(|ecdh_curve| {
            let bytes = ecdh_curve.to_utf8();
            (bytes.slice() != b"auto").then(|| SensitiveCString::new(bytes.slice()))
        });

        let ca = ca_list(vm, global, &generated.ca)?;
        let cert = handle_file_for_field(global, "cert", &generated.cert)?;
        let key = handle_file_for_field(global, "key", &generated.key)?;
        let crl = handle_file_for_field(global, "crl", &generated.crl)?;
        let key_file_name = path("keyFile", &generated.key_file)?;
        let cert_file_name = path("certFile", &generated.cert_file)?;
        let ca_file_name = path("caFile", &generated.ca_file)?;

        let protos = match &generated.alpn_protocols {
            generated::ALPNProtocols::None => None,
            generated::ALPNProtocols::String(val) => Some(from_string(val)),
            generated::ALPNProtocols::Buffer(val) => {
                Some(SensitiveCString::new(val.as_array_buffer().byte_slice()))
            }
        };
        let ssl_ciphers = generated.ciphers.as_ref().map(from_string);

        let requires_custom_request_ctx = server_name.is_some()
            || ca.is_some()
            || cert.is_some()
            || key.is_some()
            || crl.is_some()
            || generated.secure_options != 0
            || generated.ssl_min_version != 0
            || generated.ssl_max_version != 0
            || sigalgs.is_some()
            || ecdh_curve.is_some()
            || generated.session_timeout != 0
            || generated.allow_partial_trust_chain
            || key_file_name.is_some()
            || cert_file_name.is_some()
            || ca_file_name.is_some()
            || protos.is_some()
            || ssl_ciphers.is_some();
        let any = requires_custom_request_ctx
            || passphrase.is_some()
            || dh_params_file_name.is_some()
            || generated.low_memory_mode
            || generated.reject_unauthorized.is_some()
            || generated.request_cert
            || generated.client_renegotiation_limit != 0
            || generated.client_renegotiation_window != 0;
        if !any {
            return Ok(None);
        }

        let mut result = SSLConfig {
            server_name,
            key_file_name,
            cert_file_name,
            ca_file_name,
            dh_params_file_name,
            passphrase,
            key,
            cert,
            ca,
            crl,
            secure_options: generated.secure_options,
            session_timeout: generated.session_timeout,
            allow_partial_trust_chain: generated.allow_partial_trust_chain,
            sigalgs,
            ecdh_curve,
            ssl_min_version: generated.ssl_min_version,
            ssl_max_version: generated.ssl_max_version,
            request_cert: generated.request_cert as i32,
            reject_unauthorized: reject_unauthorized as i32,
            is_using_default_ciphers: ssl_ciphers.is_none(),
            ssl_ciphers,
            protos,
            client_renegotiation_limit: generated.client_renegotiation_limit,
            client_renegotiation_window: generated.client_renegotiation_window,
            requires_custom_request_ctx,
            low_memory_mode: generated.low_memory_mode,
            cached_hash: Default::default(),
        };
        // After `any`: the fallback does not make `tls: {}` a TLS configuration.
        if generated.ciphers.is_none() {
            apply_default_ciphers(vm, &mut result);
        }
        Ok(Some(result))
    }
}

/// The `SSLConfig` for the `tls: true` shorthand: every option at its
/// documented default, unlike `SSLConfig::zero()`.
pub(crate) fn tls_true_defaults(vm: &VirtualMachine, is_server: bool) -> SSLConfig {
    let mut cfg = SSLConfig::zero();
    cfg.reject_unauthorized = (is_server || vm.get_tls_reject_unauthorized()) as i32;
    apply_default_ciphers(vm, &mut cfg);
    cfg
}

/// For a request without TLS options: its default context is built on the HTTP thread, which does not see `tls.DEFAULT_CIPHERS`.
pub(crate) fn http_client_defaults(vm: &VirtualMachine) -> Option<bun_http::ssl_config::SharedPtr> {
    vm.tls_default_ciphers()?;
    Some(bun_http::ssl_config::global_registry::intern(
        tls_true_defaults(vm, false),
    ))
}

/// No `ciphers` option means `tls.DEFAULT_CIPHERS`, as in Node's `configSecureContext`.
fn apply_default_ciphers(vm: &VirtualMachine, cfg: &mut SSLConfig) {
    if let Some(ciphers) = vm.tls_default_ciphers() {
        cfg.set_default_ciphers(ciphers);
    }
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
    let files = Files::of(file);
    if files.len() == 0 {
        return Ok(None);
    }
    let mut result = Vec::with_capacity(files.len());
    for file in files {
        let contents = handle_single_file(global, file);
        result.push(contents.map_err(|err| throw_read_error(global, field, err))?);
    }
    Ok(Some(result.into_boxed_slice()))
}

fn throw_read_error(
    global: &JSGlobalObject,
    field: &'static str,
    err: ReadFromBlobError,
) -> JsError {
    match err {
        ReadFromBlobError::Js(e) => e,
        ReadFromBlobError::EmptyFile => {
            global.throw_invalid_arguments(format_args!("TLSOptions.{} is an empty file", field))
        }
        ReadFromBlobError::NullStore | ReadFromBlobError::NotAFile => global
            .throw_invalid_arguments(format_args!(
                "TLSOptions.{} is not a valid BunFile (non-BunFile `Blob`s are not supported)",
                field
            )),
    }
}

#[derive(Clone, Copy)]
enum SingleFile<'a> {
    String(&'a bun_core::String),
    Buffer(&'a jsc::JSCArrayBuffer),
    File(&'a crate::webcore::Blob),
}

/// The elements of a `ca`, `cert`, `key` or `crl` option, in order. No option and an empty array have none.
#[derive(Clone)]
struct Files<'a> {
    single: Option<SingleFile<'a>>,
    array: core::slice::Iter<'a, generated::TLSOptionsSingleFile>,
}

impl<'a> Files<'a> {
    fn of(file: &'a generated::TLSOptionsFile) -> Self {
        let mut array: &[generated::TLSOptionsSingleFile] = &[];
        let single = match file {
            generated::TLSOptionsFile::None => None,
            generated::TLSOptionsFile::String(val) => Some(SingleFile::String(val)),
            generated::TLSOptionsFile::Buffer(val) => Some(SingleFile::Buffer(val)),
            generated::TLSOptionsFile::File(val) => Some(SingleFile::File(val)),
            generated::TLSOptionsFile::Array(list) => {
                array = list;
                None
            }
        };
        Self {
            single,
            array: array.iter(),
        }
    }
}

impl<'a> Iterator for Files<'a> {
    type Item = SingleFile<'a>;

    fn next(&mut self) -> Option<SingleFile<'a>> {
        self.single.take().or_else(|| {
            Some(match self.array.next()? {
                generated::TLSOptionsSingleFile::String(val) => SingleFile::String(val),
                generated::TLSOptionsSingleFile::Buffer(val) => SingleFile::Buffer(val),
                generated::TLSOptionsSingleFile::File(val) => SingleFile::File(val),
            })
        })
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let len = usize::from(self.single.is_some()) + self.array.len();
        (len, Some(len))
    }
}

impl ExactSizeIterator for Files<'_> {}

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

// ── `ca` ─────────────────────────────────────────────────────────────

/// The `ca` lists of a VM's latest TLS options. An option that comes again finds its list here, with no pass over
/// the certificates.
#[derive(Default)]
pub(crate) struct CaListMemo {
    /// The latest first.
    entries: Vec<CaListMemoEntry>,
}

struct CaListMemoEntry {
    /// The JS strings that `list` was read from. Their text cannot change. Empty if an element was not a string.
    cells: Box<[bun_core::String]>,
    list: Arc<CaList>,
}

impl CaListMemo {
    const CAPACITY: usize = 4;

    fn use_entry(&mut self, index: usize) -> Arc<CaList> {
        self.entries[..=index].rotate_right(1);
        self.entries[0].list.clone()
    }

    /// The list that was read from these very strings.
    fn find_by_cells(&mut self, files: &Files<'_>) -> Option<Arc<CaList>> {
        let index = self.entries.iter().position(|entry| {
            entry.cells.len() == files.len()
                && files.clone().zip(&*entry.cells).all(|(file, cell)| {
                    matches!(file, SingleFile::String(string) if is_same_cell(string, cell))
                })
        })?;
        Some(self.use_entry(index))
    }

    /// The list of `strings`, by a comparison with each list here.
    fn find_by_bytes(&mut self, strings: &[CaText<'_>]) -> Option<Arc<CaList>> {
        let index = (self.entries.iter()).position(|entry| entry.list.holds(strings))?;
        Some(self.use_entry(index))
    }

    /// `cells` are the strings that `list` was read from, if every element was a string.
    fn remember(&mut self, cells: Option<Box<[bun_core::String]>>, list: &Arc<CaList>) {
        let known = (self.entries.iter()).position(|entry| Arc::ptr_eq(&entry.list, list));
        if let Some(index) = known {
            if let Some(cells) = cells {
                self.entries[index].cells = cells;
            }
            self.use_entry(index);
            return;
        }
        self.entries.truncate(Self::CAPACITY - 1);
        self.entries.insert(
            0,
            CaListMemoEntry {
                cells: cells.unwrap_or_default(),
                list: list.clone(),
            },
        );
    }
}

/// Whether two JS strings have their characters in the same memory, which never changes while one of them is held.
fn is_same_cell(a: &bun_core::String, b: &bun_core::String) -> bool {
    a.tag() == bun_core::Tag::WTFStringImpl
        && b.tag() == bun_core::Tag::WTFStringImpl
        && a.is_8bit() == b.is_8bit()
        && core::ptr::eq(a.byte_slice(), b.byte_slice())
}

/// One element of a `ca` option, read where it is.
enum CaText<'a> {
    String(bun_core::Utf8Bytes<'a>),
    Buffer(jsc::ArrayBuffer),
    File(SensitiveCString),
}

impl AsRef<[u8]> for CaText<'_> {
    fn as_ref(&self) -> &[u8] {
        match self {
            CaText::String(utf8) => utf8.slice(),
            CaText::Buffer(buffer) => buffer.byte_slice(),
            CaText::File(contents) => contents.as_bytes(),
        }
    }
}

impl Drop for CaText<'_> {
    fn drop(&mut self) {
        if let CaText::String(bun_core::Utf8Bytes::Owned(transcoded)) = self {
            bun_core::secure_zero(transcoded);
        }
    }
}

/// The `ca` option as the one list that the process has of those certificates.
fn ca_list(
    vm: &VirtualMachine,
    global: &JSGlobalObject,
    option: &generated::TLSOptionsFile,
) -> JsResult<Option<Arc<CaList>>> {
    let files = Files::of(option);
    if files.len() == 0 {
        return Ok(None);
    }
    let memo = &crate::jsc_hooks::runtime_state_of(vm).ca_lists;
    if let Some(list) = memo.with_mut(|memo| memo.find_by_cells(&files)) {
        return Ok(Some(list));
    }

    let mut texts = SmallVec::<[CaText<'_>; 1]>::with_capacity(files.len());
    for file in files.clone() {
        texts.push(match file {
            SingleFile::String(string) => CaText::String(string.to_utf8()),
            SingleFile::Buffer(buffer) => CaText::Buffer(buffer.as_array_buffer()),
            SingleFile::File(blob) => CaText::File(
                read_from_blob(global, blob).map_err(|err| throw_read_error(global, "ca", err))?,
            ),
        });
    }
    let list = memo
        .with_mut(|memo| memo.find_by_bytes(&texts))
        .unwrap_or_else(|| CaList::intern(&texts));
    let cells = files
        .map(|file| match file {
            SingleFile::String(string) => Some(string.clone()),
            SingleFile::Buffer(_) | SingleFile::File(_) => None,
        })
        .collect();
    memo.with_mut(|memo| memo.remember(cells, &list));
    Ok(Some(list))
}

// ──────────────────────────────────────────────────────────────────────────
// WebSocket C-ABI exports (parseSSLConfig / freeSSLConfig)
//
// LAYERING: the consumer is `src/http_jsc/websocket_client/
// WebSocketUpgradeClient.rs`, but `SSLConfig::from_js`
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
    // Use SSLConfig::from_js for clean and safe parsing
    let config_opt = match SSLConfig::from_js(vm, global_this, tls_value, false) {
        Ok(c) => c,
        // Exception is already set on globalThis
        Err(_) => return None,
    };
    // No TLS options provided or all defaults → null
    let config = config_opt?;
    // Allocate on heap and return pointer (ownership transferred to caller).
    Some(Box::new(config))
}

/// Free an SSLConfig previously returned by `parseSSLConfig`.
/// Exported for C++ so error/early-return paths in JSWebSocket.cpp and
/// WebSocket.cpp can release ownership without leaking the heap allocation
/// (and all duped cert/key/CA strings inside it) when `connect()` never
/// hands the pointer off to an upgrade client.
#[unsafe(no_mangle)]
extern "C" fn Bun__WebSocket__freeSSLConfig(_: Option<Box<bun_http::ssl_config::SSLConfig>>) {}
