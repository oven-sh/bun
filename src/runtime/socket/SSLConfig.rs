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

use core::ffi::{CStr, c_char};

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsError, JsResult, SysErrorJsc};
use bun_uws_sys::socket_context::c;

use crate::node::fs as node_fs;
use crate::webcore::Blob;
use crate::webcore::blob::store::Data as StoreData;

// ──────────────────────────────────────────────────────────────────────────
// Canonical re-exports (struct + registry live in bun_http now)
// ──────────────────────────────────────────────────────────────────────────

pub use bun_http::ssl_config::SSLConfig;

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

// ──────────────────────────────────────────────────────────────────────────
// Allocation helpers
//
// Every owned C-string field on `bun_http::SSLConfig` is freed via
// `bun_core::free_sensitive` (the default-allocator free after secure-zero).
// Allocate via `bun_core::dupe_z` (the matching default-allocator alloc) so the
// pairing is exact. Do NOT leak a `Box<[u8]>` here: under `cfg(bun_asan)` the
// process-global `#[global_allocator]` is `std::alloc::System`, not mimalloc,
// so `free_sensitive` would not pair with `Box`-owned memory.
// ──────────────────────────────────────────────────────────────────────────

/// `ZBox` is global-allocator memory; re-allocate via `dupe_z` so `mi_free` can free it.
#[inline]
fn zbox_into_raw(z: &bun_core::ZBox) -> *const c_char {
    bun_core::dupe_z(z.as_bytes())
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
    Ok(zbox_into_raw(&zbox))
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
        // `result` cleanup handled by Drop on error-path `?`
        let mut any = false;

        let has_pfx = ssl_config_file_is_present(&generated.pfx);
        if has_pfx
            && (ssl_config_file_is_present(&generated.key)
                || ssl_config_file_is_present(&generated.cert)
                || generated.key_file.as_ref().is_some()
                || generated.cert_file.as_ref().is_some())
        {
            return Err(global.throw_invalid_arguments(format_args!(
                "TLSOptions.pfx cannot be combined with TLSOptions.key, TLSOptions.cert, TLSOptions.keyFile, or TLSOptions.certFile"
            )));
        }

        let pfx_passphrase = if has_pfx {
            generated
                .passphrase
                .as_ref()
                .map(|passphrase| zbox_into_raw(&passphrase.to_owned_slice_z()))
        } else {
            if let Some(passphrase) = generated.passphrase.as_ref() {
                result.passphrase = zbox_into_raw(&passphrase.to_owned_slice_z());
                any = true;
            }
            None
        };
        let pfx_passphrase = scopeguard::guard(pfx_passphrase, |passphrase| {
            if let Some(passphrase) = passphrase {
                unsafe { bun_core::free_sensitive(passphrase) };
            }
        });
        if let Some(dh_params_file) = generated.dh_params_file.as_ref() {
            result.dh_params_file_name = handle_path(global, "dhParamsFile", dh_params_file)?;
            any = true;
        }
        if let Some(server_name) = generated.server_name.as_ref() {
            result.server_name = zbox_into_raw(&server_name.to_owned_slice_z());
            result.requires_custom_request_ctx = true;
        }

        result.low_memory_mode = generated.low_memory_mode;
        result.reject_unauthorized = generated
            .reject_unauthorized
            .unwrap_or_else(|| vm.get_tls_reject_unauthorized())
            as i32;
        result.request_cert = generated.request_cert as i32;
        result.secure_options = generated.secure_options;
        result.ssl_min_version = generated.ssl_min_version;
        result.ssl_max_version = generated.ssl_max_version;
        result.session_timeout = generated.session_timeout;
        result.allow_partial_trust_chain = generated.allow_partial_trust_chain;
        if let Some(sigalgs) = generated.sigalgs.as_ref() {
            result.sigalgs = zbox_into_raw(&sigalgs.to_owned_slice_z());
            any = true;
        }
        if let Some(ecdh_curve) = generated.ecdh_curve.as_ref() {
            let bytes = ecdh_curve.to_owned_slice_z();
            // Node treats `ecdhCurve: 'auto'` (the documented default) as
            // "use the library's default group list", i.e. skip the
            // SSL_CTX_set1_groups_list call entirely.
            if bytes.as_bytes() != b"auto" {
                result.ecdh_curve = zbox_into_raw(&bytes);
                any = true;
            }
        }
        any = any
            || result.low_memory_mode
            || generated.reject_unauthorized.is_some()
            || generated.request_cert
            || result.secure_options != 0
            || result.ssl_min_version != 0
            || result.ssl_max_version != 0
            || result.session_timeout != 0
            || result.allow_partial_trust_chain;

        result.ca = handle_file_for_field(global, "ca", &generated.ca)?;
        if has_pfx {
            (result.key, result.cert) =
                handle_pfx_for_field(global, &generated.pfx, pfx_passphrase.as_ref().copied())?;
            any = true;
        } else {
            result.cert = handle_file_for_field(global, "cert", &generated.cert)?;
            result.key = handle_file_for_field(global, "key", &generated.key)?;
        }
        result.crl = handle_file_for_field(global, "crl", &generated.crl)?;
        result.requires_custom_request_ctx = result.requires_custom_request_ctx
            || result.ca.is_some()
            || result.cert.is_some()
            || result.key.is_some()
            || result.crl.is_some()
            || result.secure_options != 0
            || result.ssl_min_version != 0
            || result.ssl_max_version != 0
            || !result.sigalgs.is_null()
            || !result.ecdh_curve.is_null()
            || result.session_timeout != 0
            || result.allow_partial_trust_chain;

        if let Some(key_file) = generated.key_file.as_ref() {
            result.key_file_name = handle_path(global, "keyFile", key_file)?;
            result.requires_custom_request_ctx = true;
        }
        if let Some(cert_file) = generated.cert_file.as_ref() {
            result.cert_file_name = handle_path(global, "certFile", cert_file)?;
            result.requires_custom_request_ctx = true;
        }
        if let Some(ca_file) = generated.ca_file.as_ref() {
            result.ca_file_name = handle_path(global, "caFile", ca_file)?;
            result.requires_custom_request_ctx = true;
        }

        let protocols: *const c_char = match &generated.alpn_protocols {
            jsc::generated::SSLConfigAlpnProtocols::None => core::ptr::null(),
            jsc::generated::SSLConfigAlpnProtocols::String(val) => {
                zbox_into_raw(&val.as_ref().to_owned_slice_z())
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
        if let Some(ciphers) = generated.ciphers.as_ref() {
            result.ssl_ciphers = zbox_into_raw(&ciphers.to_owned_slice_z());
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

/// The `SSLConfig` for the `tls: true` shorthand: every option at its
/// documented default, unlike `SSLConfig::zero()`.
pub fn tls_true_defaults(vm: &VirtualMachine) -> SSLConfig {
    let mut cfg = SSLConfig::zero();
    cfg.reject_unauthorized = vm.get_tls_reject_unauthorized() as i32;
    cfg
}

/// Whether a new TLS socket must enforce `rejectUnauthorized`: close the
/// connection when the peer certificate fails verification.
pub fn resolve_reject_unauthorized(
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
) -> JsResult<*const c_char> {
    let name = string.to_owned_slice_z();
    // `bun_sys::access` routes to `access(2)` on POSIX and
    // `GetFileAttributesW` on Windows (via `sys_uv`), so this is the
    // cross-platform existence probe.
    if bun_sys::access(&name, bun_sys::posix::F_OK).is_err() {
        // Error path: free_sensitive(name) — zero before drop. Route through
        // the canonical helper so the secure-zero core stays single-sourced.
        // SAFETY: `zbox_into_raw` yields a `default_alloc::malloc`-backed,
        // NUL-terminated buffer whose ownership we now hold exclusively.
        unsafe { bun_core::free_sensitive(zbox_into_raw(&name)) };
        return Err(global.throw_invalid_arguments(format_args!("Unable to access {} path", field)));
    }
    Ok(zbox_into_raw(&name))
}

fn ssl_config_file_is_present(file: &jsc::generated::SSLConfigFile) -> bool {
    !matches!(file, jsc::generated::SSLConfigFile::None)
}

fn handle_pfx_for_field(
    global: &JSGlobalObject,
    file: &jsc::generated::SSLConfigFile,
    passphrase: Option<*const c_char>,
) -> JsResult<(CStrSlice, CStrSlice)> {
    let values = match handle_binary_file(global, file) {
        Ok(Some(values)) => values,
        Ok(None) => return Ok((None, None)),
        Err(ReadFromBlobError::Js(e)) => return Err(e),
        Err(ReadFromBlobError::EmptyFile) => {
            return Err(
                global.throw_invalid_arguments(format_args!("TLSOptions.pfx is an empty file"))
            );
        }
        Err(ReadFromBlobError::NullStore) | Err(ReadFromBlobError::NotAFile) => {
            return Err(global.throw_invalid_arguments(format_args!(
                "TLSOptions.pfx is not a valid BunFile (non-BunFile `Blob`s are not supported)"
            )));
        }
    };

    let mut parsed = scopeguard::guard(
        (
            Vec::with_capacity(values.len()),
            Vec::with_capacity(values.len()),
        ),
        |(keys, certs)| {
            for value in keys.into_iter().chain(certs) {
                unsafe { bun_core::free_sensitive(value) };
            }
        },
    );
    for value in values {
        let (key, cert) = parse_pkcs12(global, &value, passphrase)?;
        parsed.0.push(key);
        parsed.1.push(cert);
    }
    let (keys, certs) = scopeguard::ScopeGuard::into_inner(parsed);
    Ok((
        Some(keys.into_boxed_slice()),
        Some(certs.into_boxed_slice()),
    ))
}

fn parse_pkcs12(
    global: &JSGlobalObject,
    pfx: &[u8],
    passphrase: Option<*const c_char>,
) -> JsResult<(*const c_char, *const c_char)> {
    let mut out_key: *mut c_char = core::ptr::null_mut();
    let mut out_cert: *mut c_char = core::ptr::null_mut();
    let mut out_ca: *mut c_char = core::ptr::null_mut();
    let mut key_len = 0usize;
    let mut cert_len = 0usize;
    let mut ca_len = 0usize;
    let mut err_reason: *const c_char = core::ptr::null();
    // SAFETY: `pfx` stays live for this call, `passphrase` is either null or an
    // owned NUL-terminated buffer, and every out-parameter points to initialized storage.
    let ok = unsafe {
        c::us_ssl_parse_pkcs12(
            pfx.as_ptr().cast(),
            pfx.len(),
            passphrase.unwrap_or(core::ptr::null()),
            &raw mut out_key,
            &raw mut key_len,
            &raw mut out_cert,
            &raw mut cert_len,
            &raw mut out_ca,
            &raw mut ca_len,
            &raw mut err_reason,
        )
    };
    unsafe extern "C" {
        fn free(ptr: *mut core::ffi::c_void);
    }
    // SAFETY: the C parser returned these buffers through exclusive malloc-owned
    // out-parameters; their lengths remain valid until the matching libc free.
    let _free = scopeguard::guard(
        (out_key, key_len, out_cert, out_ca),
        |(key, key_len, cert, ca)| unsafe {
            if !key.is_null() {
                bun_core::secure_zero(key.cast(), key_len);
                free(key.cast());
            }
            if !cert.is_null() {
                free(cert.cast());
            }
            if !ca.is_null() {
                free(ca.cast());
            }
        },
    );
    if ok == 0 {
        let reason = if err_reason.is_null() {
            ""
        } else {
            unsafe { CStr::from_ptr(err_reason) }.to_str().unwrap_or("")
        };
        let message = match reason {
            "key" => "Unable to load private key from PFX data",
            "cert" => "Unable to load certificate from PFX data",
            "mac" => "PFX MAC verification failed - is the passphrase correct?",
            _ => "Unable to load PFX certificate",
        };
        return Err(global.throw_invalid_arguments(format_args!("{message}")));
    }

    let key = dupe_z(unsafe { core::slice::from_raw_parts(out_key.cast::<u8>(), key_len) });
    let cert = if out_ca.is_null() || ca_len == 0 {
        dupe_z(unsafe { core::slice::from_raw_parts(out_cert.cast::<u8>(), cert_len) })
    } else {
        let mut chain = Vec::with_capacity(cert_len + ca_len);
        chain.extend_from_slice(unsafe {
            core::slice::from_raw_parts(out_cert.cast::<u8>(), cert_len)
        });
        chain
            .extend_from_slice(unsafe { core::slice::from_raw_parts(out_ca.cast::<u8>(), ca_len) });
        dupe_z(&chain)
    };
    Ok((key, cert))
}

struct SensitiveBytes(Vec<u8>);

impl core::ops::Deref for SensitiveBytes {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Drop for SensitiveBytes {
    fn drop(&mut self) {
        // SAFETY: `self` exclusively owns every initialized byte in the vector.
        unsafe { bun_core::secure_zero(self.0.as_mut_ptr(), self.0.len()) };
    }
}

fn invalid_pfx_type(global: &JSGlobalObject) -> ReadFromBlobError {
    ReadFromBlobError::Js(global.throw_invalid_arguments(format_args!(
        "TLSOptions.pfx must be an ArrayBufferView, ArrayBuffer, BunFile, or an array of those"
    )))
}

fn handle_binary_file(
    global: &JSGlobalObject,
    file: &jsc::generated::SSLConfigFile,
) -> Result<Option<Vec<SensitiveBytes>>, ReadFromBlobError> {
    let values = match file {
        jsc::generated::SSLConfigFile::None => return Ok(None),
        jsc::generated::SSLConfigFile::String(_) => return Err(invalid_pfx_type(global)),
        jsc::generated::SSLConfigFile::Buffer(value) => {
            let buffer: jsc::ArrayBuffer = unsafe { (*value.get()).as_array_buffer() };
            vec![SensitiveBytes(buffer.byte_slice().to_vec())]
        }
        jsc::generated::SSLConfigFile::File(value) => {
            vec![SensitiveBytes(read_binary_from_blob(global, unsafe {
                &mut *value.get().cast::<crate::webcore::Blob>()
            })?)]
        }
        jsc::generated::SSLConfigFile::Array(values) => {
            let mut result = Vec::with_capacity(values.items().len());
            for value in values.items() {
                result.push(match value {
                    jsc::generated::SSLConfigSingleFile::String(_) => {
                        return Err(invalid_pfx_type(global));
                    }
                    jsc::generated::SSLConfigSingleFile::Buffer(value) => {
                        let buffer: jsc::ArrayBuffer = unsafe { (*value.get()).as_array_buffer() };
                        SensitiveBytes(buffer.byte_slice().to_vec())
                    }
                    jsc::generated::SSLConfigSingleFile::File(value) => {
                        SensitiveBytes(read_binary_from_blob(global, unsafe {
                            &mut *value.get().cast::<crate::webcore::Blob>()
                        })?)
                    }
                });
            }
            result
        }
    };
    if values.is_empty() || values.iter().any(|value| value.is_empty()) {
        return Err(ReadFromBlobError::EmptyFile);
    }
    Ok((!values.is_empty()).then_some(values))
}

fn read_binary_from_blob(
    global: &JSGlobalObject,
    blob: &Blob,
) -> Result<Vec<u8>, ReadFromBlobError> {
    let store = blob
        .store
        .get()
        .as_ref()
        .ok_or(ReadFromBlobError::NullStore)?;
    let file = match &store.data {
        StoreData::File(file) => file,
        _ => return Err(ReadFromBlobError::NotAFile),
    };
    let mut fs = node_fs::NodeFS::default();
    let mut read_args = node_fs::args::ReadFile::default();
    read_args.encoding = crate::node::types::Encoding::Buffer;
    read_args.path = file.pathlike.clone();
    let mut result = fs
        .read_file(&read_args, node_fs::Flavor::Sync)
        .map_err(|err| ReadFromBlobError::Js(global.throw_value(err.to_js(global)).into()))?;
    let bytes = result.slice().to_vec();
    if let crate::node::types::StringOrBuffer::Buffer(buffer) = &mut result {
        debug_assert!(buffer.owns_buffer);
        if buffer.owns_buffer {
            let source = buffer.buffer.byte_slice_mut();
            // SAFETY: this synchronous read result exclusively owns `source` until destroy.
            unsafe { bun_core::secure_zero(source.as_mut_ptr(), source.len()) };
        }
        buffer.destroy();
    }
    if bytes.is_empty() {
        return Err(ReadFromBlobError::EmptyFile);
    }
    Ok(bytes)
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
            jsc::generated::SSLConfigFile::String(val) => SingleFile::String(val.as_ref()),
            jsc::generated::SSLConfigFile::Buffer(val) => {
                // SAFETY: GenVal::get() yields a non-null pointer valid for the
                // lifetime of `generated`; we narrow it to `&mut` for the call.
                SingleFile::Buffer(unsafe { &mut *val.get() })
            }
            jsc::generated::SSLConfigFile::File(val) => {
                // SAFETY: opaque `GenBlob` (`*mut c_void`) is the JS class `m_ctx`
                // pointer, layout-identical to `crate::webcore::Blob`.
                SingleFile::File(unsafe { &mut *val.get().cast::<crate::webcore::Blob>() })
            }
            jsc::generated::SSLConfigFile::Array(list) => {
                return handle_file_array(global, list.items());
            }
        },
    )?;
    // The only fallible op below is alloc, and Rust aborts on OOM, so no
    // error-path zeroing is needed.
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
    // Error path: free_sensitive each, then drop result — need zeroing on error:
    let mut guard = scopeguard::guard(&mut result, |r| {
        for p in r.drain(..) {
            // SAFETY: every pushed `p` came from `handle_single_file` →
            // `zbox_into_raw`, a `default_alloc::malloc`-backed NUL-terminated buffer.
            unsafe { bun_core::free_sensitive(p) };
        }
    });
    for elem in elements {
        guard.push(handle_single_file(
            global,
            match elem {
                jsc::generated::SSLConfigSingleFile::String(val) => {
                    SingleFile::String(val.as_ref())
                }
                jsc::generated::SSLConfigSingleFile::Buffer(val) => {
                    // SAFETY: see `handle_file` above — non-null GenVal pointers
                    // valid for the lifetime of `generated`.
                    SingleFile::Buffer(unsafe { &mut *val.get() })
                }
                jsc::generated::SSLConfigSingleFile::File(val) => {
                    // SAFETY: opaque `GenBlob` (`*mut c_void`) is layout-identical
                    // to `crate::webcore::Blob`.
                    SingleFile::File(unsafe { &mut *val.get().cast::<crate::webcore::Blob>() })
                }
            },
        )?);
    }
    let result = scopeguard::ScopeGuard::into_inner(guard);
    Ok(Some(core::mem::take(result).into_boxed_slice()))
}

enum SingleFile<'a> {
    String(&'a bun_core::String),
    Buffer(&'a mut jsc::JSCArrayBuffer),
    File(&'a mut crate::webcore::Blob),
}

fn handle_single_file(
    global: &JSGlobalObject,
    file: SingleFile<'_>,
) -> Result<*const c_char, ReadFromBlobError> {
    match file {
        SingleFile::String(string) => Ok(zbox_into_raw(&string.to_owned_slice_z())),
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
/// hands the pointer off to an upgrade client.
///
/// # Safety
/// `config` must be null or a pointer previously returned by
/// `Bun__WebSocket__parseSSLConfig` whose ownership the caller is transferring
/// back (i.e. not already freed or handed to an upgrade client).
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__WebSocket__freeSSLConfig(config: *mut bun_http::ssl_config::SSLConfig) {
    // SAFETY: caller upholds the `# Safety` contract above — `config` is null
    // or a live pointer from `Bun__WebSocket__parseSSLConfig` whose ownership
    // is being transferred back. `heap::take` handles the null case.
    drop(unsafe { bun_core::heap::take(config) });
}
