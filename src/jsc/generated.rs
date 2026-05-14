//! Hand-written Rust surface for the `.bindv2.ts` / `.classes.ts` codegen.
//!
//! Two distinct generators feed this file:
//!
//!   1. **bindgen option-structs** (`src/codegen/bindgen.ts` →
//!      `build/*/codegen/bindgen_generated/*.zig`). Each emits a
//!      `bindgenConvertJSTo<Name>` C++ shim that fills a `#[repr(C)]` extern
//!      struct, plus a `convertFromExtern` that reshapes it into the public
//!      Zig/Rust type. `from_js` glues the two.
//!
//!   2. **per-class accessor modules** (`src/codegen/generate-classes.ts` →
//!      `ZigGeneratedClasses.zig`). Each `JS${Type}` exposes
//!      `from_js` / `from_js_direct` / `to_js` / `get_constructor` thin-wrapping
//!      the `${Type}__fromJS` / `__fromJSDirect` / `__create` / `__getConstructor`
//!      C++ exports, plus one `${name}_get_cached` / `${name}_set_cached` pair
//!      per `cache: true` property.
//!
//! Until both generators grow a `.rs` backend, this file ports their output by
//! hand for the handful of shapes downstream crates name directly
//! (`bun_jsc::generated::{SocketConfig*, SSLConfig*, JSTimeout, JSImmediate,
//! JSBlob, JSResponse, JSRequest}`).
//!
//! Symbol-naming contract (kept in sync with generate-classes.ts):
//!   `${T}Prototype__${name}GetCachedValue(JSValue) -> JSValue`
//!   `${T}Prototype__${name}SetCachedValue(JSValue, *JSGlobalObject, JSValue)`
//!   `${T}__fromJS` / `${T}__fromJSDirect` / `${T}__create` / `${T}__getConstructor`

#![allow(dead_code, unused_variables, non_snake_case)]

use core::ffi::c_uint;
use core::mem::MaybeUninit;

use crate::{JSCArrayBuffer, JSGlobalObject, JSValue, JsError, JsResult};

// ──────────────────────────────────────────────────────────────────────────
// Generic accessor wrappers.
//
// The Zig bindgen emits per-field newtypes with `.get()` (optional) /
// `.items()` (array). Dependents pattern-match on these without naming the
// wrapper type directly, so a pair of generic carriers covers every field.
// ──────────────────────────────────────────────────────────────────────────

/// Optional-value accessor: `field.get() -> Option<T>`.
#[derive(Debug, Default)]
pub struct GenOpt<T>(Option<T>);

impl<T: Clone> GenOpt<T> {
    #[inline]
    pub fn get(&self) -> Option<T> {
        self.0.clone()
    }
}

/// Required-value accessor: `field.get() -> T` (used inside tagged-union arms).
#[derive(Debug)]
pub struct GenVal<T>(T);

impl<T: Clone> GenVal<T> {
    #[inline]
    pub fn get(&self) -> T {
        self.0.clone()
    }
}

/// Array accessor: `field.items() -> &[T]`.
#[derive(Debug, Default)]
pub struct GenList<T>(Vec<T>);

impl<T> GenList<T> {
    #[inline]
    pub fn items(&self) -> &[T] {
        &self.0
    }
}

/// Bindgen option-structs for `BunObject.bind.ts` (`GeneratedBindings.zig`).
pub mod bun_object {
    /// `gen.BunObject.BracesOptions` — `#[repr(C)]` extern struct passed by
    /// pointer from the C++ dispatch shim. Field order matches
    /// `GeneratedBindings.zig` (`parse`, `tokenize`).
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct BracesOptions {
        pub parse: bool,
        pub tokenize: bool,
    }
}

// Shorthand for the bindgen string payload. The real generator hands back a
// `bun.String` / `WTFStringImpl`; downstream code only calls `.length()` /
// `.to_utf8()` / `.to_owned_slice_z()` on it, all of which `bun_core::String`
// already provides.
pub type GenString = bun_core::String;

/// `bun.bun_js.jsc.JSCArrayBuffer.Ref` — adopted `*mut JSC::ArrayBuffer` (refcount
/// already +1 from C++); deref via `JSC__ArrayBuffer__deref` on drop.
// TODO(port): wrap in `bun_ptr::ExternalShared<JSCArrayBuffer>` once that crate
// exposes `adopt(*mut T)`. Raw ptr for now (Phase A — leak on drop).
pub type GenArrayBuffer = *mut JSCArrayBuffer;

/// `bun.bun_js.webcore.Blob.Ref` — adopted `*mut Blob` (the codegen `m_ctx`
/// payload). LAYERING: `webcore::Blob` lives in `bun_runtime` (a dependent of
/// this crate); the bindgen extern struct only ever stores the raw pointer
/// (filled by C++ `bindgenConvertJSTo*`), so it stays erased as `*mut c_void`
/// here and is cast to `*mut bun_runtime::webcore::Blob` by the consumer in
/// `bun_runtime::api::bun::spawn::stdio::convert_from_extern`.
pub type GenBlob = *mut core::ffi::c_void;

// ──────────────────────────────────────────────────────────────────────────
// Extern-ABI helper layouts (mirror `src/jsc/bindgen.zig`).
//
// `ExternTaggedUnion(&.{T0, T1, ...})` in Zig is `extern struct { data:
// extern union { @"0": T0, ... }, tag: u8 }`. Rust has no variadic
// `#[repr(C)] union`, so we hand-roll the few arities the bindgen actually
// emits for the structs below. All extern types are `Copy` POD; the
// `convert_from_extern` step takes ownership of any embedded heap refs.
// ──────────────────────────────────────────────────────────────────────────

type RawWTFStringImpl = *mut bun_core::WTFStringImplStruct;

/// `BindgenOptional(BindgenTrivial<T>).ExternType` — `T` has no custom
/// `OptionalExternType`, so the C++ side wraps it in a 2-arm tagged union
/// `{ data: union { _0: u8 /* unused */, _1: T }, tag: u8 }`.
#[repr(C)]
#[derive(Clone, Copy)]
struct ExternOptional<T: Copy> {
    data: ExternOptionalData<T>,
    tag: u8,
}

#[repr(C)]
#[derive(Clone, Copy)]
union ExternOptionalData<T: Copy> {
    _0: u8,
    _1: T,
}

impl<T: Copy> ExternOptional<T> {
    #[inline]
    fn get(self) -> Option<T> {
        if self.tag == 0 {
            return None;
        }
        debug_assert_eq!(self.tag, 1);
        // SAFETY: tag == 1 ⇒ C++ initialized the `_1` arm.
        Some(unsafe { self.data._1 })
    }
}

/// `bindgen.ExternArrayList(T)` — `extern struct { data: ?[*]T, length: c_uint,
/// capacity: c_uint }`.
// Clone/Copy: bitwise OK — FFI mirror of a C++ buffer; Rust treats it as a
// borrowed view and adopts ownership exactly once at the call site.
#[repr(C)]
#[derive(Clone, Copy)]
struct ExternArrayList<T> {
    data: *mut T, // null = empty
    length: c_uint,
    capacity: c_uint,
}

#[inline]
fn adopt_string(ptr: RawWTFStringImpl) -> GenString {
    // C++ hands back a +1 ref; `adopt_wtf_impl` takes ownership (no inc).
    bun_core::String::adopt_wtf_impl(ptr)
}

#[inline]
fn adopt_opt_string(ptr: RawWTFStringImpl) -> GenOpt<GenString> {
    // `BindgenOptional(BindgenString).ExternType` is `?WTFStringImpl` — single-word
    // nullable ptr (custom `OptionalExternType`), NOT an `ExternTaggedUnion`.
    GenOpt(if ptr.is_null() {
        None
    } else {
        Some(adopt_string(ptr))
    })
}

// ──────────────────────────────────────────────────────────────────────────
// SocketConfigHandlers (build/*/codegen/bindgen_generated/socket_config_handlers.zig)
// ──────────────────────────────────────────────────────────────────────────

#[repr(u32)]
#[derive(Debug, Default, Clone, Copy)]
pub enum SocketConfigHandlersBinaryType {
    Arraybuffer = 0,
    #[default]
    Buffer = 1,
    Uint8array = 2,
}

pub struct SocketConfigHandlers {
    pub on_open: JSValue,
    pub on_close: JSValue,
    pub on_data: JSValue,
    pub on_writable: JSValue,
    pub on_timeout: JSValue,
    pub on_connect_error: JSValue,
    pub on_end: JSValue,
    pub on_error: JSValue,
    pub on_handshake: JSValue,
    pub binary_type: SocketConfigHandlersBinaryType,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ExternSocketConfigHandlers {
    onOpen: JSValue,
    onClose: JSValue,
    onError: JSValue,
    onData: JSValue,
    onWritable: JSValue,
    onHandshake: JSValue,
    onEnd: JSValue,
    onConnectError: JSValue,
    onTimeout: JSValue,
    binary_type: SocketConfigHandlersBinaryType,
}

// safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
// ABI-identical to non-null `*mut`); `&mut MaybeUninit<T>` is ABI-identical to
// non-null `*mut T` (`MaybeUninit<T>` is layout-transparent over `T`). The C++
// side fully initializes `*result` iff it returns `true`.
unsafe extern "C" {
    safe fn bindgenConvertJSToSocketConfigHandlers(
        global: &JSGlobalObject,
        value: JSValue,
        result: &mut MaybeUninit<ExternSocketConfigHandlers>,
    ) -> bool;
}

impl SocketConfigHandlers {
    fn convert_from_extern(ext: ExternSocketConfigHandlers) -> Self {
        Self {
            on_open: ext.onOpen,
            on_close: ext.onClose,
            on_error: ext.onError,
            on_data: ext.onData,
            on_writable: ext.onWritable,
            on_handshake: ext.onHandshake,
            on_end: ext.onEnd,
            on_connect_error: ext.onConnectError,
            on_timeout: ext.onTimeout,
            binary_type: ext.binary_type,
        }
    }

    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        // Zig wraps this in an `ExceptionValidationScope` for the
        // `assertExceptionPresenceMatches(!success)` check; the scope must exist
        // *before* the FFI call so the C++ ThrowScope's `simulateThrow()` is
        // satisfied under `validateExceptionChecks=1`.
        let mut ext = MaybeUninit::<ExternSocketConfigHandlers>::uninit();
        crate::call_false_is_throw(global, || {
            bindgenConvertJSToSocketConfigHandlers(global, value, &mut ext)
        })?;
        // SAFETY: success ⇒ C++ initialized `ext`.
        Ok(Self::convert_from_extern(unsafe { ext.assume_init() }))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SSLConfig (build/*/codegen/bindgen_generated/ssl_config.zig + friends)
// ──────────────────────────────────────────────────────────────────────────

pub enum SSLConfigAlpnProtocols {
    None,
    String(GenVal<GenString>),
    Buffer(GenVal<GenArrayBuffer>),
}

/// `string | Buffer | BunFile` element of an SSL file-ish option.
pub enum SSLConfigSingleFile {
    String(GenVal<GenString>),
    Buffer(GenVal<GenArrayBuffer>),
    File(GenVal<GenBlob>),
}

/// `string | Buffer | BunFile | Array<...>` — the full file-ish option.
pub enum SSLConfigFile {
    None,
    String(GenVal<GenString>),
    Buffer(GenVal<GenArrayBuffer>),
    File(GenVal<GenBlob>),
    Array(GenList<SSLConfigSingleFile>),
}

pub struct SSLConfig {
    pub passphrase: GenOpt<GenString>,
    pub dh_params_file: GenOpt<GenString>,
    pub server_name: GenOpt<GenString>,
    pub low_memory_mode: bool,
    pub reject_unauthorized: Option<bool>,
    pub request_cert: bool,
    pub secure_options: u32,
    pub ca: SSLConfigFile,
    pub cert: SSLConfigFile,
    pub key: SSLConfigFile,
    pub key_file: GenOpt<GenString>,
    pub cert_file: GenOpt<GenString>,
    pub ca_file: GenOpt<GenString>,
    pub alpn_protocols: SSLConfigAlpnProtocols,
    pub ciphers: GenOpt<GenString>,
    pub client_renegotiation_limit: u32,
    pub client_renegotiation_window: u32,
}

// ── refcount release on drop ──────────────────────────────────────────────
//
// `adopt_string` adopts a +1 `WTF::StringImpl` ref into a `GenString`
// (= `bun_core::String`), which is `Copy` and has no `Drop`. The Zig
// bindgen output instead types these fields as `bun.string.WTFString.Optional`
// — an RAII `WTF::Ref`-alike whose `deinit()` derefs — and the generated
// struct's `deinit()` calls `bun.memory.deinit(&field)` on each. We replicate
// that here by deref-ing every owned string field from the container's `Drop`
// (matches `bindgen_generated.SSLConfig.deinit` in ssl_config.zig).
//
// `GenArrayBuffer` / `GenBlob` raw-pointer payloads also carry an adopted +1
// ref and are still leaked on drop — tracked by the `pub type` TODOs above;
// out of scope here.
//
// `.get()` on `GenOpt` / `GenVal` returns a *bitwise* `Clone` of the
// `bun_core::String` (the derived `Clone`, not the inherent `clone()` which
// bumps), so it does not take an additional ref — the single adopted ref stays
// owned by the field and is released exactly once below.

#[inline]
fn release_gen_opt_string(s: &GenOpt<GenString>) {
    if let Some(string) = &s.0 {
        // Releases the +1 ref adopted by `adopt_opt_string` / `adopt_string`.
        string.deref();
    }
}

#[inline]
fn release_gen_val_string(s: &GenVal<GenString>) {
    // Releases the +1 ref adopted by `adopt_string`.
    s.0.deref();
}

impl Drop for SSLConfigAlpnProtocols {
    fn drop(&mut self) {
        if let SSLConfigAlpnProtocols::String(v) = self {
            release_gen_val_string(v);
        }
    }
}

impl Drop for SSLConfigSingleFile {
    fn drop(&mut self) {
        if let SSLConfigSingleFile::String(v) = self {
            release_gen_val_string(v);
        }
    }
}

impl Drop for SSLConfigFile {
    fn drop(&mut self) {
        // `Array` recursively drops each `SSLConfigSingleFile`; `Buffer` / `File`
        // are raw-ptr payloads (see module note above).
        if let SSLConfigFile::String(v) = self {
            release_gen_val_string(v);
        }
    }
}

impl Drop for SSLConfig {
    fn drop(&mut self) {
        release_gen_opt_string(&self.passphrase);
        release_gen_opt_string(&self.dh_params_file);
        release_gen_opt_string(&self.server_name);
        // `ca` / `cert` / `key`: `SSLConfigFile` — released by its own `Drop`.
        release_gen_opt_string(&self.key_file);
        release_gen_opt_string(&self.cert_file);
        release_gen_opt_string(&self.ca_file);
        // `alpn_protocols`: `SSLConfigAlpnProtocols` — released by its own `Drop`.
        release_gen_opt_string(&self.ciphers);
    }
}

// ── extern layouts ────────────────────────────────────────────────────────

/// `BindgenSSLConfigSingleFile.ExternType` =
/// `ExternTaggedUnion(&.{ ?WTFStringImpl, ?*JSCArrayBuffer, ?*Blob })`.
#[repr(C)]
#[derive(Clone, Copy)]
struct ExternSSLConfigSingleFile {
    data: ExternSSLConfigSingleFileData,
    tag: u8,
}

#[repr(C)]
#[derive(Clone, Copy)]
union ExternSSLConfigSingleFileData {
    _0: RawWTFStringImpl,
    _1: GenArrayBuffer,
    _2: GenBlob,
}

impl SSLConfigSingleFile {
    fn convert_from_extern(ext: ExternSSLConfigSingleFile) -> Self {
        // SAFETY: each arm reads the union field selected by `tag`, which C++
        // guarantees is the initialized one.
        match ext.tag {
            0 => Self::String(GenVal(adopt_string(unsafe { ext.data._0 }))),
            1 => Self::Buffer(GenVal(unsafe { ext.data._1 })),
            2 => Self::File(GenVal(unsafe { ext.data._2 })),
            // SAFETY: tag space is 0..=2 per bindgen contract.
            _ => unsafe { core::hint::unreachable_unchecked() },
        }
    }
}

/// `BindgenSSLConfigFile.ExternType` = `ExternTaggedUnion(&.{ u8, ?WTFStringImpl,
/// ?*JSCArrayBuffer, ?*Blob, ExternArrayList<ExternSSLConfigSingleFile> })`.
#[repr(C)]
#[derive(Clone, Copy)]
struct ExternSSLConfigFile {
    data: ExternSSLConfigFileData,
    tag: u8,
}

#[repr(C)]
#[derive(Clone, Copy)]
union ExternSSLConfigFileData {
    _0: u8, // BindgenNull
    _1: RawWTFStringImpl,
    _2: GenArrayBuffer,
    _3: GenBlob,
    _4: ExternArrayList<ExternSSLConfigSingleFile>,
}

impl SSLConfigFile {
    fn convert_from_extern(ext: ExternSSLConfigFile) -> Self {
        // SAFETY: each arm reads the union field selected by `tag`.
        match ext.tag {
            0 => Self::None,
            1 => Self::String(GenVal(adopt_string(unsafe { ext.data._1 }))),
            2 => Self::Buffer(GenVal(unsafe { ext.data._2 })),
            3 => Self::File(GenVal(unsafe { ext.data._3 })),
            4 => {
                // SAFETY: tag == 4 ⇒ `_4` is the initialized arm.
                let arr = unsafe { ext.data._4 };
                let len = arr.length as usize;
                let mut out = Vec::with_capacity(len);
                if !arr.data.is_null() {
                    for i in 0..len {
                        // SAFETY: `arr.data` points to `length` initialized elements
                        // (mimalloc-backed; C++ transferred ownership).
                        let elem = unsafe { *arr.data.add(i) };
                        out.push(SSLConfigSingleFile::convert_from_extern(elem));
                    }
                    // PORT NOTE: Zig `BindgenArray` reuses the allocation in-place
                    // when `ZigType == ExternType`. Phase A copies-then-frees the
                    // source buffer; in-place reuse deferred.
                    // PERF(port): was BindgenArray in-place convert — profile in Phase B
                    // `arr.data` was allocated by `WTF::fastMalloc` ≡ mimalloc
                    // (per crate prereq); `mi_free` is size-agnostic.
                    bun_alloc::basic::free_without_size(arr.data.cast());
                }
                Self::Array(GenList(out))
            }
            // SAFETY: tag space is 0..=4 per bindgen contract.
            _ => unsafe { core::hint::unreachable_unchecked() },
        }
    }
}

/// `BindgenALPNProtocols.ExternType` =
/// `ExternTaggedUnion(&.{ u8, ?WTFStringImpl, ?*JSCArrayBuffer })`.
#[repr(C)]
#[derive(Clone, Copy)]
struct ExternALPNProtocols {
    data: ExternALPNProtocolsData,
    tag: u8,
}

#[repr(C)]
#[derive(Clone, Copy)]
union ExternALPNProtocolsData {
    _0: u8,
    _1: RawWTFStringImpl,
    _2: GenArrayBuffer,
}

impl SSLConfigAlpnProtocols {
    fn convert_from_extern(ext: ExternALPNProtocols) -> Self {
        // SAFETY: each arm reads the union field selected by `tag`.
        match ext.tag {
            0 => Self::None,
            1 => Self::String(GenVal(adopt_string(unsafe { ext.data._1 }))),
            2 => Self::Buffer(GenVal(unsafe { ext.data._2 })),
            // SAFETY: tag space is 0..=2 per bindgen contract.
            _ => unsafe { core::hint::unreachable_unchecked() },
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ExternSSLConfig {
    passphrase: RawWTFStringImpl,
    dh_params_file: RawWTFStringImpl,
    server_name: RawWTFStringImpl,
    low_memory_mode: bool,
    reject_unauthorized: ExternOptional<bool>,
    request_cert: bool,
    ca: ExternSSLConfigFile,
    cert: ExternSSLConfigFile,
    key: ExternSSLConfigFile,
    secure_options: u32,
    key_file: RawWTFStringImpl,
    cert_file: RawWTFStringImpl,
    ca_file: RawWTFStringImpl,
    alpn_protocols: ExternALPNProtocols,
    ciphers: RawWTFStringImpl,
    client_renegotiation_limit: u32,
    client_renegotiation_window: u32,
}

// safe: same handle/out-param contract as
// `bindgenConvertJSToSocketConfigHandlers` above.
unsafe extern "C" {
    safe fn bindgenConvertJSToSSLConfig(
        global: &JSGlobalObject,
        value: JSValue,
        result: &mut MaybeUninit<ExternSSLConfig>,
    ) -> bool;
}

impl SSLConfig {
    fn convert_from_extern(ext: ExternSSLConfig) -> Self {
        Self {
            passphrase: adopt_opt_string(ext.passphrase),
            dh_params_file: adopt_opt_string(ext.dh_params_file),
            server_name: adopt_opt_string(ext.server_name),
            low_memory_mode: ext.low_memory_mode,
            reject_unauthorized: ext.reject_unauthorized.get(),
            request_cert: ext.request_cert,
            ca: SSLConfigFile::convert_from_extern(ext.ca),
            cert: SSLConfigFile::convert_from_extern(ext.cert),
            key: SSLConfigFile::convert_from_extern(ext.key),
            secure_options: ext.secure_options,
            key_file: adopt_opt_string(ext.key_file),
            cert_file: adopt_opt_string(ext.cert_file),
            ca_file: adopt_opt_string(ext.ca_file),
            alpn_protocols: SSLConfigAlpnProtocols::convert_from_extern(ext.alpn_protocols),
            ciphers: adopt_opt_string(ext.ciphers),
            client_renegotiation_limit: ext.client_renegotiation_limit,
            client_renegotiation_window: ext.client_renegotiation_window,
        }
    }

    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        let mut ext = MaybeUninit::<ExternSSLConfig>::uninit();
        crate::call_false_is_throw(global, || {
            bindgenConvertJSToSSLConfig(global, value, &mut ext)
        })?;
        // SAFETY: success ⇒ C++ initialized `ext`.
        Ok(Self::convert_from_extern(unsafe { ext.assume_init() }))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SocketConfig (build/*/codegen/bindgen_generated/socket_config.zig)
// ──────────────────────────────────────────────────────────────────────────

pub enum SocketConfigTls {
    None,
    Boolean(bool),
    Object(SSLConfig),
}

pub struct SocketConfig {
    pub tls: SocketConfigTls,
    pub fd: Option<i32>,
    pub handlers: SocketConfigHandlers,
    pub data: JSValue,
    pub unix_: GenOpt<GenString>,
    pub hostname: GenOpt<GenString>,
    pub port: Option<u16>,
    pub exclusive: bool,
    pub allow_half_open: bool,
    pub reuse_port: bool,
    pub ipv6_only: bool,
}

impl Drop for SocketConfig {
    fn drop(&mut self) {
        // `tls`: `SocketConfigTls::Object` holds `SSLConfig`, released by its
        // own `Drop`. `handlers`: only `JSValue`s — no owned refs.
        release_gen_opt_string(&self.unix_);
        release_gen_opt_string(&self.hostname);
    }
}

/// `BindgenSocketConfigTLS.ExternType` =
/// `ExternTaggedUnion(&.{ u8, bool, ExternSSLConfig })`.
#[repr(C)]
#[derive(Clone, Copy)]
struct ExternSocketConfigTLS {
    data: ExternSocketConfigTLSData,
    tag: u8,
}

#[repr(C)]
#[derive(Clone, Copy)]
union ExternSocketConfigTLSData {
    _0: u8,
    _1: bool,
    _2: ExternSSLConfig,
}

impl SocketConfigTls {
    fn convert_from_extern(ext: ExternSocketConfigTLS) -> Self {
        // SAFETY: each arm reads the union field selected by `tag`.
        match ext.tag {
            0 => Self::None,
            1 => Self::Boolean(unsafe { ext.data._1 }),
            2 => Self::Object(SSLConfig::convert_from_extern(unsafe { ext.data._2 })),
            // SAFETY: tag space is 0..=2 per bindgen contract.
            _ => unsafe { core::hint::unreachable_unchecked() },
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ExternSocketConfig {
    handlers: ExternSocketConfigHandlers,
    data: JSValue,
    allow_half_open: bool,
    hostname: RawWTFStringImpl,
    port: ExternOptional<u16>,
    tls: ExternSocketConfigTLS,
    exclusive: bool,
    reuse_port: bool,
    ipv6_only: bool,
    unix_: RawWTFStringImpl,
    fd: ExternOptional<i32>,
}

// safe: same handle/out-param contract as
// `bindgenConvertJSToSocketConfigHandlers` above.
unsafe extern "C" {
    safe fn bindgenConvertJSToSocketConfig(
        global: &JSGlobalObject,
        value: JSValue,
        result: &mut MaybeUninit<ExternSocketConfig>,
    ) -> bool;
}

impl SocketConfig {
    fn convert_from_extern(ext: ExternSocketConfig) -> Self {
        Self {
            handlers: SocketConfigHandlers::convert_from_extern(ext.handlers),
            data: ext.data,
            allow_half_open: ext.allow_half_open,
            hostname: adopt_opt_string(ext.hostname),
            port: ext.port.get(),
            tls: SocketConfigTls::convert_from_extern(ext.tls),
            exclusive: ext.exclusive,
            reuse_port: ext.reuse_port,
            ipv6_only: ext.ipv6_only,
            unix_: adopt_opt_string(ext.unix_),
            fd: ext.fd.get(),
        }
    }

    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        let mut ext = MaybeUninit::<ExternSocketConfig>::uninit();
        crate::call_false_is_throw(global, || {
            bindgenConvertJSToSocketConfig(global, value, &mut ext)
        })?;
        // SAFETY: success ⇒ C++ initialized `ext`.
        Ok(Self::convert_from_extern(unsafe { ext.assume_init() }))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Per-class cached-accessor modules (`jsc.Codegen.JS*` in Zig).
//
// Each `JS${Type}` module exposes the C++-side hooks the `.classes.ts`
// generator emits: `from_js` / `from_js_direct` / `to_js` / `get_constructor`
// plus one `${name}_get_cached` / `${name}_set_cached` pair per
// `cache: true` property. The bodies are filled in by
// `bun_jsc::codegen_cached_accessors!` — see that macro for the extern-symbol
// contract.
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// Thin host-fn forwarders for `cache: true` properties.
//
// `js_class_module!` / `generate-classes.ts` already emit
// `${prop}_get_cached`/`${prop}_set_cached` (and a `Gc` enum) per cached prop.
// Several JS classes (MySQLConnection, PostgresSQLConnection, RedisClient)
// then hand-write the *other* half — the `get_*`/`set_*` host-fns that the
// `.classes.ts` getter/setter thunks dispatch to — as pure forwarding shims.
// This macro stamps those out so the per-class `impl` block is one line per
// prop instead of ~10.
//
// `($get, $set => $prop)` maps the codegen-expected host-fn idents (snake-
// cased from the `.classes.ts` getter/setter names, e.g. `get_on_connect`)
// to the cached-accessor prop ident (`onconnect`). The two namings are NOT
// derivable from each other (`on_connect` vs `onconnect`), hence the explicit
// mapping. `lazy_array($get => $prop)` covers the `queries`-style getter that
// lazily seeds the slot with an empty `JSArray` on first read.
//
// The emitted setter returns `()` — `host_fn_setter_this[_shared]` accepts
// that via `IntoHostSetterReturn for ()` (≡ `true` at the ABI), so this is
// drop-in for both `sharedThis` and `&mut`-receiver classes.
// ──────────────────────────────────────────────────────────────────────────

/// Stamp out trivial cached-prop getter/setter host-fns inside an `impl` block.
///
/// ```ignore
/// bun_jsc::cached_prop_hostfns! {
///     crate::jsc::codegen::JSPostgresSQLConnection;
///     lazy_array(get_queries => queries),
///     (get_on_connect, set_on_connect => onconnect),
///     (get_on_close,   set_on_close   => onclose),
/// }
/// ```
#[macro_export]
macro_rules! cached_prop_hostfns {
    ($gen:path; $($rest:tt)*) => {
        $crate::cached_prop_hostfns!(@loop $gen; $($rest)*);
    };
    (@loop $gen:path;) => {};
    // lazy-array getter (seeds an empty `JSArray` on first read).
    // `$gc/$sc` are the codegen'd `${prop}_get_cached`/`${prop}_set_cached`
    // free fns in `$gen` — passed explicitly because `macro_rules!` can't
    // camelCase→snake_case the prop ident.
    (@loop $gen:path; lazy_array($get:ident => $gc:ident, $sc:ident) $(, $($rest:tt)*)?) => {
        pub fn $get(
            _this: &Self,
            this_value: $crate::JSValue,
            global: &$crate::JSGlobalObject,
        ) -> $crate::JsResult<$crate::JSValue> {
            use $gen as __g;
            if let ::core::option::Option::Some(v) = __g::$gc(this_value) {
                return ::core::result::Result::Ok(v);
            }
            let array = $crate::JSValue::create_empty_array(global, 0)?;
            __g::$sc(this_value, global, array);
            ::core::result::Result::Ok(array)
        }
        $crate::cached_prop_hostfns!(@loop $gen; $($($rest)*)?);
    };
    // plain getter+setter pair
    (@loop $gen:path; ($get:ident, $set:ident => $gc:ident, $sc:ident) $(, $($rest:tt)*)?) => {
        pub fn $get(
            _this: &Self,
            this_value: $crate::JSValue,
            _global: &$crate::JSGlobalObject,
        ) -> $crate::JSValue {
            use $gen as __g;
            __g::$gc(this_value).unwrap_or($crate::JSValue::UNDEFINED)
        }
        pub fn $set(
            _this: &Self,
            this_value: $crate::JSValue,
            global: &$crate::JSGlobalObject,
            value: $crate::JSValue,
        ) {
            use $gen as __g;
            __g::$sc(this_value, global, value);
        }
        $crate::cached_prop_hostfns!(@loop $gen; $($($rest)*)?);
    };
}

/// Stamp out the `do_ref`/`do_unref` host-fn pair that forwards to a
/// `JsCell<KeepAlive>`-shaped field. Expands inside an `impl` block.
///
/// ```ignore
/// bun_jsc::poll_ref_hostfns!(field = poll_ref, ctx = vm_ctx);
/// bun_jsc::poll_ref_hostfns!(field = poll_ref, ctx = vm_ctx,
///     after = |this: &Self| this.update_has_pending_activity());
/// ```
#[macro_export]
macro_rules! poll_ref_hostfns {
    (field = $field:ident, ctx = $ctx:ident $(, after = $after:expr)? $(,)?) => {
        pub fn do_ref(
            this: &Self,
            _: &$crate::JSGlobalObject,
            _: &$crate::CallFrame,
        ) -> $crate::JsResult<$crate::JSValue> {
            let ctx = this.$ctx();
            this.$field.with_mut(|p| p.ref_(ctx));
            $( ($after)(this); )?
            ::core::result::Result::Ok($crate::JSValue::UNDEFINED)
        }
        pub fn do_unref(
            this: &Self,
            _: &$crate::JSGlobalObject,
            _: &$crate::CallFrame,
        ) -> $crate::JsResult<$crate::JSValue> {
            let ctx = this.$ctx();
            this.$field.with_mut(|p| p.unref(ctx));
            $( ($after)(this); )?
            ::core::result::Result::Ok($crate::JSValue::UNDEFINED)
        }
    };
}

// ──────────────────────────────────────────────────────────────────────────
// `impl_js_class_via_generated!` — single-source `JsClass` impl that delegates
// to a per-type generated accessor module (any module exposing the standard
// `from_js` / `from_js_direct` / `to_js` [/ `get_constructor`] free-fn surface:
// `crate::generated_classes::js_$T` from generate-classes.ts, the
// `js_class_module!` expansions in this file, or `bun_sql_jsc::jsc::codegen`).
//
// The three generators disagree on `from_js`'s return shape
// (`Option<NonNull<T>>` vs `Option<*mut T>` vs `Option<*mut ()>`); the
// [`IntoRawMut`] adapter erases that difference with a single `.cast()`, so
// one macro body compiles against all three. `to_js` uniformly takes
// `*mut <gen-payload>`, which `.cast()` reaches from `*mut Self` regardless of
// whether the payload is `Self`, `Self<'static>`, or type-erased `()`.
// ──────────────────────────────────────────────────────────────────────────

/// Adapter erasing the `from_js` return-type difference between accessor-module
/// generators (`NonNull<U>` vs `*mut U`). Used by
/// [`impl_js_class_via_generated!`]; not part of the public API.
#[doc(hidden)]
pub trait IntoRawMut<T> {
    fn into_raw_mut(self) -> *mut T;
}
#[doc(hidden)]
impl<T, U> IntoRawMut<T> for core::ptr::NonNull<U> {
    #[inline]
    fn into_raw_mut(self) -> *mut T {
        self.as_ptr().cast()
    }
}
#[doc(hidden)]
impl<T, U> IntoRawMut<T> for *mut U {
    #[inline]
    fn into_raw_mut(self) -> *mut T {
        self.cast()
    }
}

/// `impl JsClass for $T` that boxes `self` into the GC-owned `m_ctx` slot and
/// routes every method through `$gen` (a `js_$T`-shaped accessor module).
///
/// # Forms
/// ```ignore
/// impl_js_class_via_generated!(Foo => crate::generated_classes::js_Foo);
/// impl_js_class_via_generated!(Foo => path::to::JSFoo, no_constructor);
/// impl_js_class_via_generated!(for<'a> Foo<'a> => js_Foo, no_constructor);
/// ```
///
/// `no_constructor` skips `get_constructor` (the `.classes.ts` `noConstructor:
/// true` case — no `${T}__getConstructor` C++ export); the trait default
/// (`JSValue::UNDEFINED`) applies.
///
/// **Do not use** when `to_js` carries side-effects beyond box-and-hand-off
/// (e.g. `Request` runs `calculate_estimated_byte_size` + body-stream GC
/// migration) or when the payload is intrusively refcounted and never held
/// by-value (e.g. `HTMLBundle`).
#[macro_export]
macro_rules! impl_js_class_via_generated {
    // `for<…>` arms FIRST: a leading `for` would otherwise feed into the `:ty`
    // arm's fragment parser, which commits to HRTB syntax and hard-errors on
    // `for<'a> Struct<'a>` ("expected trait") instead of backtracking.
    (for<$($lt:lifetime),+> $T:ty => $gen:path) => {
        $crate::impl_js_class_via_generated!(@emit { $($lt),+ } $T => $gen { with_ctor });
    };
    (for<$($lt:lifetime),+> $T:ty => $gen:path, no_constructor) => {
        $crate::impl_js_class_via_generated!(@emit { $($lt),+ } $T => $gen {});
    };
    ($T:ty => $gen:path) => {
        $crate::impl_js_class_via_generated!(@emit {} $T => $gen { with_ctor });
    };
    ($T:ty => $gen:path, no_constructor) => {
        $crate::impl_js_class_via_generated!(@emit {} $T => $gen {});
    };
    (@emit { $($lt:lifetime),* } $T:ty => $gen:path { $($with_ctor:ident)? }) => {
        impl<$($lt),*> $crate::JsClass for $T {
            #[inline]
            fn from_js(v: $crate::JSValue) -> ::core::option::Option<*mut Self> {
                use $gen as __g;
                __g::from_js(v).map($crate::generated::IntoRawMut::into_raw_mut)
            }
            #[inline]
            fn from_js_direct(v: $crate::JSValue) -> ::core::option::Option<*mut Self> {
                use $gen as __g;
                __g::from_js_direct(v).map($crate::generated::IntoRawMut::into_raw_mut)
            }
            #[inline]
            fn to_js(self, g: &$crate::JSGlobalObject) -> $crate::JSValue {
                use $gen as __g;
                // Ownership of the boxed payload transfers to the C++ wrapper
                // (freed via `${T}Class__finalize`). `.cast()` erases any
                // payload-type / lifetime mismatch between `Self` and the
                // accessor module's monomorphized pointee.
                __g::to_js($crate::heap::into_raw(::std::boxed::Box::new(self)).cast(), g)
            }
            $(
                #[inline]
                fn get_constructor(g: &$crate::JSGlobalObject) -> $crate::JSValue {
                    let _: &str = ::core::stringify!($with_ctor); // bind the rep var
                    use $gen as __g;
                    __g::get_constructor(g)
                }
            )?
        }
    };
}

/// Expands to a `pub mod $mod` containing the standard `.classes.ts` codegen
/// surface for a JS wrapper class: `from_js` / `from_js_direct` / `from_js_ref`
/// / `to_js` / `to_js_unchecked` / `dangerously_set_ptr` / `get_constructor`,
/// plus a cached-accessor pair per listed property.
///
/// Mirrors Zig `jsc.Codegen.JS${T}` (one impl, generated once — see
/// `src/codegen/generate-classes.ts:2428`). All extern symbols use
/// `JSC_CALLCONV` (= sysv64 on win-x64, C otherwise).
///
/// `$Payload` is the native `m_ctx` payload type. When the payload struct is
/// defined in (or below) this crate — e.g. `webcore_types::Blob` — pass it so
/// the extern signatures here unify with that file's typed declarations
/// (avoids `clashing_extern_declarations`). When the payload lives in a
/// dependent crate (`bun_runtime`), pass `()` (type-erased; the dependent
/// crate casts).
///
/// # Forms
/// ```ignore
/// js_class_module!(JSFoo = "Foo" { propA, propB });                 // Payload = ()
/// js_class_module!(JSFoo = "Foo" as super::Foo { propA });          // typed Payload
/// js_class_module!(JSFoo = "Foo" as super::Foo, impl_js_class {});  // + impl JsClass for Foo
/// ```
#[macro_export]
macro_rules! js_class_module {
    // Shorthand: payload erased to `()` (lives in a higher crate).
    (
        $mod_name:ident = $TypeName:literal { $( $prop:ident ),* $(,)? }
    ) => {
        $crate::js_class_module!($mod_name = $TypeName as () { $( $prop ),* });
    };
    // Typed payload + auto-`impl JsClass for $Payload` delegating back into the
    // emitted module. Opt-in (some payloads — e.g. the SQL connection types —
    // hand-roll `JsClass` separately to layer on extra behaviour).
    (
        $mod_name:ident = $TypeName:literal as $Payload:ty, impl_js_class { $( $prop:ident ),* $(,)? }
    ) => {
        $crate::js_class_module!($mod_name = $TypeName as $Payload { $( $prop ),* });
        $crate::impl_js_class_via_generated!($Payload => $mod_name);
    };
    (
        $mod_name:ident = $TypeName:literal as $Payload:ty { $( $prop:ident ),* $(,)? }
    ) => {
        #[allow(non_snake_case)]
        pub mod $mod_name {
            use $crate::{JSGlobalObject, JSValue};
            $crate::codegen_cached_accessors!($TypeName; $( $prop ),*);

            type Payload = $Payload;

            // `${TypeName}__fromJS` / `__fromJSDirect` / `__create` /
            // `__getConstructor` — implemented in C++ by
            // `src/codegen/generate-classes.ts` (`symbolName(typeName, name)`
            // ⇒ `${typeName}__${name}`). All use `JSC_CALLCONV` (= sysv64 on
            // win-x64, C otherwise).
            //
            // `improper_ctypes`: when `$Payload` is a real Rust struct (e.g.
            // `Blob`) the lint recurses through its fields and flags
            // non-`#[repr(C)]` interiors. The pointer is opaque to C++ — only
            // Rust dereferences it — so the lint is a false positive here.
            // `safe fn`: `JSValue` is a by-value tagged i64 and `JSGlobalObject`
            // is an opaque `UnsafeCell`-backed ZST handle (`&` is ABI-identical
            // to a non-null `*mut`). `__from_js*` only type-check the encoded
            // value and return the stored `m_ctx` pointer (or null) — the C++
            // side never dereferences `Payload`, so there is no Rust-side
            // precondition. `__create`/`__dangerously_set_ptr` keep `unsafe`
            // because they install `ptr` into a GC cell whose finalizer will
            // later free it (deferred deref → ownership precondition).
            $crate::jsc_abi_extern! {
                #[allow(improper_ctypes)]
                {
                    #[link_name = concat!($TypeName, "__fromJS")]
                    safe fn __from_js(value: JSValue) -> *mut Payload;
                    #[link_name = concat!($TypeName, "__fromJSDirect")]
                    safe fn __from_js_direct(value: JSValue) -> *mut Payload;
                    #[link_name = concat!($TypeName, "__create")]
                    fn __create(global: *mut JSGlobalObject, ptr: *mut Payload) -> JSValue;
                    #[link_name = concat!($TypeName, "__getConstructor")]
                    safe fn __get_constructor(global: &JSGlobalObject) -> JSValue;
                    #[link_name = concat!($TypeName, "__dangerouslySetPtr")]
                    fn __dangerously_set_ptr(value: JSValue, ptr: *mut Payload) -> bool;
                }
            }

            /// Return the wrapped native pointer if `value` is (a subclass of)
            /// the JS wrapper type; `None` on type mismatch.
            #[inline]
            pub fn from_js(value: JSValue) -> ::core::option::Option<*mut Payload> {
                let ptr = __from_js(value);
                if ptr.is_null() { None } else { Some(ptr) }
            }

            /// As `from_js`, but only matches *direct* instances with the
            /// canonical structure (no subclass / no expando properties).
            #[inline]
            pub fn from_js_direct(value: JSValue) -> ::core::option::Option<*mut Payload> {
                let ptr = __from_js_direct(value);
                if ptr.is_null() { None } else { Some(ptr) }
            }

            /// [`from_js`] as a [`ParentRef`](::bun_ptr::ParentRef) — wraps the
            /// raw `m_ctx` backref deref. The payload is GC-rooted by the
            /// caller's `CallFrame` for the duration of the host call, so the
            /// `ParentRef` invariant (pointee outlives holder) holds for any
            /// stack-scoped use.
            #[inline]
            pub fn from_js_ref(v: JSValue) -> ::core::option::Option<::bun_ptr::ParentRef<Payload>> {
                from_js(v)
                    .and_then(::core::ptr::NonNull::new)
                    .map(::bun_ptr::ParentRef::from)
            }

            /// Create a new JS wrapper instance owning `ptr`. The C++ side
            /// allocates the JSCell with the cached structure and stores `ptr`
            /// in `m_ctx`; ownership transfers to the GC (`finalize` frees it).
            #[inline]
            pub fn to_js(ptr: *mut Payload, global: &JSGlobalObject) -> JSValue {
                // SAFETY: `global` is an opaque ZST FFI handle (see
                // `JSGlobalObject::as_ptr`) — the `*mut` is passed across FFI
                // only, never written through on the Rust side; `ptr` is a
                // freshly boxed native payload (not yet owned by any wrapper).
                unsafe { __create(global.as_ptr(), ptr) }
            }

            /// Zig-compat alias for [`to_js`] with `(global, ptr)` argument
            /// order — matches `jsc.Codegen.JS${T}.toJSUnchecked` so ported
            /// `Response::to_js` / `Request::to_js` call sites resolve without
            /// reordering.
            #[inline]
            pub fn to_js_unchecked(global: &JSGlobalObject, ptr: *mut Payload) -> JSValue {
                to_js(ptr, global)
            }

            /// Lazily fetch the constructor `JSFunction` from `globalObject`.
            #[inline]
            pub fn get_constructor(global: &JSGlobalObject) -> JSValue {
                __get_constructor(global)
            }

            /// Detach (`ptr = null`) or replace the wrapped native pointer on
            /// an existing JS wrapper. Returns `false` if `value` is not (a
            /// subclass of) the wrapper type. Mirrors Zig
            /// `js.dangerouslySetPtr` (ZigGeneratedClasses.zig).
            ///
            /// # Safety
            /// Caller must ensure the previous `m_ctx` is finalized exactly
            /// once elsewhere — the C++ side overwrites without freeing.
            #[inline]
            pub unsafe fn dangerously_set_ptr(value: JSValue, ptr: *mut Payload) -> bool {
                // SAFETY: `value` is a valid encoded JSValue; the C++ side
                // type-checks before writing `m_ctx`.
                unsafe { __dangerously_set_ptr(value, ptr) }
            }
        }
    };
}

js_class_module!(JSTimeout   = "Timeout"   { callback, arguments, idleTimeout, repeat, idleStart });
js_class_module!(JSImmediate = "Immediate" { callback, arguments });
// Payload `Blob` lives in this crate (`webcore_types`) — pass it so the extern
// signatures unify with the typed declarations there.
js_class_module!(JSBlob      = "Blob"      as crate::webcore_types::Blob { name, stream });
js_class_module!(JSResponse  = "Response"  { body, headers, url, statusText, stream });
js_class_module!(JSRequest   = "Request"   { body, headers, url, signal, stream });
// `values: ["ondrain", "oncancel", "stream"]` in src/runtime/api/ResumableSink.classes.ts.
js_class_module!(JSResumableFetchSink    = "ResumableFetchSink"    { ondrain, oncancel, stream });
js_class_module!(JSResumableS3UploadSink = "ResumableS3UploadSink" { ondrain, oncancel, stream });
// `values: ["resolve", "reject"]` in src/runtime/api/Shell.classes.ts.
js_class_module!(JSShellInterpreter      = "ShellInterpreter"      { resolve, reject });
// `src/runtime/crypto/crypto.classes.ts` — one entry per `StaticCryptoHasher`
// monomorphization (Zig: `@field(jsc.Codegen, "JS" ++ name)`). Payload erased;
// the native struct lives in `bun_runtime::crypto`.
js_class_module!(JSMD4        = "MD4"        {});
js_class_module!(JSMD5        = "MD5"        {});
js_class_module!(JSSHA1       = "SHA1"       {});
js_class_module!(JSSHA224     = "SHA224"     {});
js_class_module!(JSSHA256     = "SHA256"     {});
js_class_module!(JSSHA384     = "SHA384"     {});
js_class_module!(JSSHA512     = "SHA512"     {});
js_class_module!(JSSHA512_256 = "SHA512_256" {});

// ported from: build/*/codegen/bindgen_generated/{socket_config*,ssl_config*}.zig
