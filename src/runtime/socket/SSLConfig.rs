//! DEDUP(D202): the `SSLConfig` struct, its `Clone`/`Drop`/`Default`/hash/
//! equality/registry impls, and `as_usockets*`/`for_client_verification` were
//! double-ported (here and in `bun_http::ssl_config`). The lower-tier
//! `bun_http` copy is canonical (JSC-free, matches the Zig `?[*:0]const u8`
//! field layout); this module now re-exports it and keeps ONLY the
//! JSC-dependent constructors (`from_js` / `from_generated` / blob+path
//! readers) plus the WebSocket C-ABI exports, which need `bun_jsc` /
//! `webcore::Blob` / `node_fs` (tier-6).
//!
//! `from_js`/`from_generated` cannot be inherent `impl SSLConfig` (orphan
//! rule on a foreign type), so they're provided via the [`SSLConfigFromJs`]
//! extension trait. Import that trait to call `SSLConfig::from_js(..)`.

use core::ffi::c_char;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsError, JsResult, SysErrorJsc};

use crate::node::fs as node_fs;
use crate::webcore::Blob;
use crate::webcore::blob::store::Data as StoreData;

// ──────────────────────────────────────────────────────────────────────────
// Canonical re-exports (struct + registry live in bun_http now)
// ──────────────────────────────────────────────────────────────────────────

pub use bun_http::ssl_config::{
    GlobalRegistry, SSLConfig, SharedPtr, SslConfig, WeakPtr, global_registry,
};

// ──────────────────────────────────────────────────────────────────────────
// ReadFromBlobError
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: cannot derive `thiserror::Error` because `JsError` is not
// `std::error::Error`/`Display`. Manual `From<JsError>` instead.
#[derive(Debug)]
pub enum ReadFromBlobError {
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

// ──────────────────────────────────────────────────────────────────────────
// Allocation helpers
//
// Every owned C-string field on `bun_http::SSLConfig` is freed via
// `bun_core::free_sensitive` (== `mi_free` after secure-zero). Allocate via
// `bun_core::dupe_z` (== `mi_malloc`) so the allocator pairing is exact, OR
// leak a `Box<[u8]>` allocation directly (the process-global
// `#[global_allocator]` is mimalloc, so `mi_free` pairs with `Box`-owned
// memory too — same invariant the previous `into_http()` bridge relied on
// via `CString::into_raw`).
// ──────────────────────────────────────────────────────────────────────────

/// Transfer ownership of a `ZBox` (NUL-terminated `Box<[u8]>`) to a raw
/// `*const c_char`. No reallocation. Freed by `bun_core::free_sensitive`
/// (mimalloc) in `SSLConfig::deinit`.
#[inline]
fn zbox_into_raw(z: bun_core::ZBox) -> *const c_char {
    let mut b = z.into_vec_with_nul().into_boxed_slice();
    debug_assert_eq!(b.last(), Some(&0));
    let p = b.as_mut_ptr() as *const c_char;
    core::mem::forget(b);
    p
}

/// `dupeZ` a byte slice into a fresh mimalloc allocation.
#[inline]
fn dupe_z(bytes: &[u8]) -> *const c_char {
    bun_core::dupe_z(bytes)
}

type CStrSlice = Option<Box<[*const c_char]>>;

fn read_from_blob(
    global: &JSGlobalObject,
    blob: &Blob,
) -> Result<*const c_char, ReadFromBlobError> {
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
    // `ReadFile` has a `Drop` impl (releases its `signal` ref), so functional
    // record update from `..Default::default()` would partially move out of a
    // `Drop` type. Mutate-after-default instead.
    let mut read_args = node_fs::args::ReadFile::default();
    read_args.path = file.pathlike.clone();
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
    // `read_file_with_options(NullTerminated)` transfers ownership of the
    // returned buffer to the caller, so we can return it directly without
    // duplicating.
    let node_fs::ret::ReadFileWithOptions::NullTerminated(zbox) = result else {
        unreachable!("ReadFileStringType::NullTerminated always yields the NullTerminated variant");
    };
    if zbox.is_empty() {
        return Err(ReadFromBlobError::EmptyFile);
    }
    Ok(zbox_into_raw(zbox))
}

// ──────────────────────────────────────────────────────────────────────────
// fromJS / fromGenerated — extension trait (orphan-rule workaround)
// ──────────────────────────────────────────────────────────────────────────

/// JSC-dependent constructors for the canonical `bun_http::SSLConfig`.
/// Import this trait to call `SSLConfig::from_js(..)` / `::from_generated(..)`.
pub trait SSLConfigFromJs: Sized {
    fn from_js(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<Self>>;

    fn from_generated(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        generated: &jsc::generated::SSLConfig,
    ) -> JsResult<Option<Self>>;
}

impl SSLConfigFromJs for SSLConfig {
    fn from_js(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<SSLConfig>> {
        let generated = jsc::generated::SSLConfig::from_js(global, value)?;
        // `generated` dropped at scope exit
        Self::from_generated(vm, global, &generated)
    }

    fn from_generated(
        vm: &VirtualMachine,
        global: &JSGlobalObject,
        generated: &jsc::generated::SSLConfig,
    ) -> JsResult<Option<SSLConfig>> {
        let mut result = SSLConfig::zero();
        // errdefer result.deinit() — handled by Drop on error-path `?`
        let mut any = false;

        if let Some(passphrase) = generated.passphrase.get() {
            result.passphrase = zbox_into_raw(passphrase.to_owned_slice_z());
            any = true;
        }
        if let Some(dh_params_file) = generated.dh_params_file.get() {
            result.dh_params_file_name = handle_path(global, "dhParamsFile", &dh_params_file)?;
            any = true;
        }
        if let Some(server_name) = generated.server_name.get() {
            result.server_name = zbox_into_raw(server_name.to_owned_slice_z());
            result.requires_custom_request_ctx = true;
        }

        result.low_memory_mode = generated.low_memory_mode;
        result.reject_unauthorized = generated
            .reject_unauthorized
            .unwrap_or_else(|| vm.get_tls_reject_unauthorized())
            as i32;
        result.request_cert = generated.request_cert as i32;
        result.secure_options = generated.secure_options;
        any = any
            || result.low_memory_mode
            || generated.reject_unauthorized.is_some()
            || generated.request_cert
            || result.secure_options != 0;

        result.ca = handle_file_for_field(global, "ca", &generated.ca)?;
        result.cert = handle_file_for_field(global, "cert", &generated.cert)?;
        result.key = handle_file_for_field(global, "key", &generated.key)?;
        result.requires_custom_request_ctx = result.requires_custom_request_ctx
            || result.ca.is_some()
            || result.cert.is_some()
            || result.key.is_some();

        if let Some(key_file) = generated.key_file.get() {
            result.key_file_name = handle_path(global, "keyFile", &key_file)?;
            result.requires_custom_request_ctx = true;
        }
        if let Some(cert_file) = generated.cert_file.get() {
            result.cert_file_name = handle_path(global, "certFile", &cert_file)?;
            result.requires_custom_request_ctx = true;
        }
        if let Some(ca_file) = generated.ca_file.get() {
            result.ca_file_name = handle_path(global, "caFile", &ca_file)?;
            result.requires_custom_request_ctx = true;
        }

        let protocols: *const c_char = match &generated.alpn_protocols {
            jsc::generated::SSLConfigAlpnProtocols::None => core::ptr::null(),
            jsc::generated::SSLConfigAlpnProtocols::String(val) => {
                zbox_into_raw(val.get().to_owned_slice_z())
            }
            jsc::generated::SSLConfigAlpnProtocols::Buffer(val) => {
                // SAFETY: `val.get()` returns a non-null `*mut JSCArrayBuffer`
                // owned by the GenVal for the duration of `generated`.
                let buffer: jsc::ArrayBuffer = unsafe { (*val.get()).as_array_buffer() };
                dupe_z(buffer.byte_slice())
            }
        };
        if !protocols.is_null() {
            result.protos = protocols;
            result.requires_custom_request_ctx = true;
        }
        if let Some(ciphers) = generated.ciphers.get() {
            result.ssl_ciphers = zbox_into_raw(ciphers.to_owned_slice_z());
            result.is_using_default_ciphers = false;
            result.requires_custom_request_ctx = true;
        }

        result.client_renegotiation_limit = generated.client_renegotiation_limit;
        result.client_renegotiation_window = generated.client_renegotiation_window;
        any = any
            || result.requires_custom_request_ctx
            || result.client_renegotiation_limit != 0
            || generated.client_renegotiation_window != 0;

        // We don't need to deinit `result` if `any` is false.
        if any { Ok(Some(result)) } else { Ok(None) }
    }
}

/// Free-function aliases for callers that prefer module-path syntax.
#[inline]
pub fn from_js(
    vm: &VirtualMachine,
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<SSLConfig>> {
    <SSLConfig as SSLConfigFromJs>::from_js(vm, global, value)
}

#[inline]
pub fn from_generated(
    vm: &VirtualMachine,
    global: &JSGlobalObject,
    generated: &jsc::generated::SSLConfig,
) -> JsResult<Option<SSLConfig>> {
    <SSLConfig as SSLConfigFromJs>::from_generated(vm, global, generated)
}

// ── handlePath / handleFile helpers ──────────────────────────────────

// PERF(port): was comptime monomorphization (comptime field: []const u8) —
// demoted to runtime &'static str since only used in cold error message.
fn handle_path(
    global: &JSGlobalObject,
    field: &'static str,
    string: &bun_core::String,
) -> JsResult<*const c_char> {
    let name = string.to_owned_slice_z();
    // Zig: `std.posix.system.access(name, F_OK) != 0`. `bun_sys::access`
    // routes to `access(2)` on POSIX and `GetFileAttributesW` on Windows
    // (via `sys_uv`), so this is the cross-platform existence probe.
    if bun_sys::access(&name, bun_sys::posix::F_OK).is_err() {
        // errdefer: free_sensitive(name) — zero before drop. Route through
        // the canonical helper so the secure-zero core stays single-sourced.
        bun_core::free_sensitive(zbox_into_raw(name));
        return Err(global.throw_invalid_arguments(format_args!("Unable to access {} path", field)));
    }
    Ok(zbox_into_raw(name))
}

fn handle_file_for_field(
    global: &JSGlobalObject,
    field: &'static str,
    file: &jsc::generated::SSLConfigFile,
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
    file: &jsc::generated::SSLConfigFile,
) -> Result<CStrSlice, ReadFromBlobError> {
    let single = handle_single_file(
        global,
        match file {
            jsc::generated::SSLConfigFile::None => return Ok(None),
            jsc::generated::SSLConfigFile::String(val) => SingleFile::String(val.get()),
            // SAFETY: GenVal::get() yields a non-null pointer valid for the
            // lifetime of `generated`; we narrow it to `&mut` for the call.
            jsc::generated::SSLConfigFile::Buffer(val) => {
                SingleFile::Buffer(unsafe { &mut *val.get() })
            }
            // SAFETY: opaque `GenBlob` (`*mut c_void`) is the JS class `m_ctx`
            // pointer, layout-identical to `crate::webcore::Blob`.
            jsc::generated::SSLConfigFile::File(val) => {
                SingleFile::File(unsafe { &mut *val.get().cast::<crate::webcore::Blob>() })
            }
            jsc::generated::SSLConfigFile::Array(list) => {
                return handle_file_array(global, list.items());
            }
        },
    )?;
    // errdefer free_sensitive(single) — on the only fallible op below (alloc),
    // Rust aborts on OOM, so no errdefer needed.
    Ok(Some(vec![single].into_boxed_slice()))
}

fn handle_file_array(
    global: &JSGlobalObject,
    elements: &[jsc::generated::SSLConfigSingleFile],
) -> Result<CStrSlice, ReadFromBlobError> {
    if elements.is_empty() {
        return Ok(None);
    }
    let mut result: Vec<*const c_char> = Vec::with_capacity(elements.len());
    // errdefer { free_sensitive each; drop result } — need zeroing on error:
    let mut guard = scopeguard::guard(&mut result, |r| {
        for p in r.drain(..) {
            bun_core::free_sensitive(p);
        }
    });
    for elem in elements {
        // PERF(port): was appendAssumeCapacity
        guard.push(handle_single_file(
            global,
            match elem {
                jsc::generated::SSLConfigSingleFile::String(val) => SingleFile::String(val.get()),
                // SAFETY: see `handle_file` above — non-null GenVal pointers
                // valid for the lifetime of `generated`.
                jsc::generated::SSLConfigSingleFile::Buffer(val) => {
                    SingleFile::Buffer(unsafe { &mut *val.get() })
                }
                // SAFETY: opaque `GenBlob` (`*mut c_void`) is layout-identical
                // to `crate::webcore::Blob`.
                jsc::generated::SSLConfigSingleFile::File(val) => {
                    SingleFile::File(unsafe { &mut *val.get().cast::<crate::webcore::Blob>() })
                }
            },
        )?);
    }
    let result = scopeguard::ScopeGuard::into_inner(guard);
    Ok(Some(core::mem::take(result).into_boxed_slice()))
}

// PORT NOTE: Zig used an anonymous `union(enum)` param; named here.
enum SingleFile<'a> {
    String(bun_core::String),
    Buffer(&'a mut jsc::JSCArrayBuffer),
    File(&'a mut crate::webcore::Blob),
}

fn handle_single_file(
    global: &JSGlobalObject,
    file: SingleFile<'_>,
) -> Result<*const c_char, ReadFromBlobError> {
    match file {
        SingleFile::String(string) => Ok(zbox_into_raw(string.to_owned_slice_z())),
        SingleFile::Buffer(jsc_buffer) => {
            let buffer: jsc::ArrayBuffer = jsc_buffer.as_array_buffer();
            Ok(dupe_z(buffer.byte_slice()))
        }
        SingleFile::File(blob) => read_from_blob(global, blob),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WebSocket C-ABI exports (parseSSLConfig / freeSSLConfig)
//
// LAYERING: ground truth is `src/http_jsc/websocket_client/
// WebSocketUpgradeClient.zig::parseSSLConfig`, but `SSLConfig::from_js`
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
pub extern "C" fn Bun__WebSocket__parseSSLConfig(
    global_this: &JSGlobalObject,
    tls_value: JSValue,
) -> Option<Box<bun_http::ssl_config::SSLConfig>> {
    // SAFETY: `bun_vm()` returns the live VM for this global; the WebSocket
    // constructor only runs on the JS thread with an initialized VM.
    let vm = global_this.bun_vm();
    // Use SSLConfig::from_js for clean and safe parsing
    let config_opt = match SSLConfig::from_js(vm, global_this, tls_value) {
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
/// hands the pointer off to a Zig upgrade client.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__WebSocket__freeSSLConfig(config: *mut bun_http::ssl_config::SSLConfig) {
    // SAFETY: C++-only entry point; `config` was produced by `heap::alloc`
    // (via `Option<Box<_>>` FFI niche) in `Bun__WebSocket__parseSSLConfig` and
    // the caller transfers ownership back. `bun_http::SSLConfig::drop` runs
    // `deinit()`.
    drop(unsafe { bun_core::heap::take(config) });
}

// ported from: src/runtime/socket/SSLConfig.zig
