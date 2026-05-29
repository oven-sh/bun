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

use core::ffi::c_uint;
use core::mem::MaybeUninit;

use crate::{JSCArrayBuffer, JSGlobalObject, JSValue, JsResult};

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

pub type GenString = bun_core::String;

pub type GenArrayBuffer = *mut JSCArrayBuffer;

pub type GenBlob = *mut core::ffi::c_void;

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

unsafe extern "C" {
    safe fn bindgenConvertJSToSocketConfigHandlers(
        global: &JSGlobalObject,
        value: JSValue,
        result: &mut MaybeUninit<ExternSocketConfigHandlers>,
    ) -> bool;
}

impl SocketConfigHandlers {
    fn convert_from_extern(ext: &ExternSocketConfigHandlers) -> Self {
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
        let mut ext = MaybeUninit::<ExternSocketConfigHandlers>::uninit();
        crate::call_false_is_throw(global, || {
            bindgenConvertJSToSocketConfigHandlers(global, value, &mut ext)
        })?;
        // SAFETY: success ⇒ C++ initialized `ext`.
        Ok(Self::convert_from_extern(unsafe { ext.assume_init_ref() }))
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

#[inline]
fn release_gen_val_array_buffer(b: &GenVal<GenArrayBuffer>) {
    if !b.0.is_null() {
        // SAFETY: `b.0` is the `RefPtr<JSC::ArrayBuffer>::leakRef()` result from
        // C++ `ExternTraits` — a live `JSC::ArrayBuffer*` carrying +1.
        unsafe { <JSCArrayBuffer as bun_ptr::ExternalSharedDescriptor>::ext_deref(b.0) };
    }
}

#[inline]
fn release_gen_val_blob(b: &GenVal<GenBlob>) {
    if !b.0.is_null() {
        // SAFETY: `b.0` is the `RefPtr<BlobImpl>::leakRef()` result from C++
        // `ExternTraits` — a live heap-allocated `Blob*` carrying +1.
        unsafe {
            <crate::webcore_types::Blob as bun_ptr::ExternalSharedDescriptor>::ext_deref(
                b.0.cast::<crate::webcore_types::Blob>(),
            )
        };
    }
}

impl Drop for SSLConfigAlpnProtocols {
    fn drop(&mut self) {
        match self {
            SSLConfigAlpnProtocols::None => {}
            SSLConfigAlpnProtocols::String(v) => release_gen_val_string(v),
            SSLConfigAlpnProtocols::Buffer(v) => release_gen_val_array_buffer(v),
        }
    }
}

impl Drop for SSLConfigSingleFile {
    fn drop(&mut self) {
        match self {
            SSLConfigSingleFile::String(v) => release_gen_val_string(v),
            SSLConfigSingleFile::Buffer(v) => release_gen_val_array_buffer(v),
            SSLConfigSingleFile::File(v) => release_gen_val_blob(v),
        }
    }
}

impl Drop for SSLConfigFile {
    fn drop(&mut self) {
        // `Array` recursively drops each `SSLConfigSingleFile`.
        match self {
            SSLConfigFile::None | SSLConfigFile::Array(_) => {}
            SSLConfigFile::String(v) => release_gen_val_string(v),
            SSLConfigFile::Buffer(v) => release_gen_val_array_buffer(v),
            SSLConfigFile::File(v) => release_gen_val_blob(v),
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
            // SAFETY: tag == 0 ⇒ `_0` is the initialized union arm.
            0 => Self::String(GenVal(adopt_string(unsafe { ext.data._0 }))),
            // SAFETY: tag == 1 ⇒ `_1` is the initialized union arm.
            1 => Self::Buffer(GenVal(unsafe { ext.data._1 })),
            // SAFETY: tag == 2 ⇒ `_2` is the initialized union arm.
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
            // SAFETY: tag == 1 ⇒ `_1` is the initialized union arm.
            1 => Self::String(GenVal(adopt_string(unsafe { ext.data._1 }))),
            // SAFETY: tag == 2 ⇒ `_2` is the initialized union arm.
            2 => Self::Buffer(GenVal(unsafe { ext.data._2 })),
            // SAFETY: tag == 3 ⇒ `_3` is the initialized union arm.
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
                    // when `ZigType == ExternType`. This path copies-then-frees the
                    // source buffer; in-place reuse deferred.
                    // PERF(port): was BindgenArray in-place convert — profile if it shows up on a hot path.
                    // SAFETY: `arr.data` was allocated by `WTF::fastMalloc` ≡ mimalloc
                    // (per crate prereq); `mi_free` is size-agnostic.
                    unsafe { bun_alloc::basic::free_without_size(arr.data.cast()) };
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
            // SAFETY: tag == 1 ⇒ `_1` is the initialized union arm.
            1 => Self::String(GenVal(adopt_string(unsafe { ext.data._1 }))),
            // SAFETY: tag == 2 ⇒ `_2` is the initialized union arm.
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
    fn convert_from_extern(ext: &ExternSSLConfig) -> Self {
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
        Ok(Self::convert_from_extern(unsafe { ext.assume_init_ref() }))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SocketConfig (build/*/codegen/bindgen_generated/socket_config.zig)
// ──────────────────────────────────────────────────────────────────────────

pub enum SocketConfigTls {
    None,
    Boolean(bool),
    Object(Box<SSLConfig>),
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
    fn convert_from_extern(ext: &ExternSocketConfigTLS) -> Self {
        // SAFETY: each arm reads the union field selected by `tag`.
        match ext.tag {
            0 => Self::None,
            // SAFETY: tag == 1 ⇒ `_1` is the initialized union arm.
            1 => Self::Boolean(unsafe { ext.data._1 }),
            // SAFETY: tag == 2 ⇒ `_2` is the initialized union arm.
            2 => Self::Object(Box::new(SSLConfig::convert_from_extern(unsafe {
                &ext.data._2
            }))),
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
    fn convert_from_extern(ext: &ExternSocketConfig) -> Self {
        Self {
            handlers: SocketConfigHandlers::convert_from_extern(&ext.handlers),
            data: ext.data,
            allow_half_open: ext.allow_half_open,
            hostname: adopt_opt_string(ext.hostname),
            port: ext.port.get(),
            tls: SocketConfigTls::convert_from_extern(&ext.tls),
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
        Ok(Self::convert_from_extern(unsafe { ext.assume_init_ref() }))
    }
}

#[macro_export]
macro_rules! cached_prop_hostfns {
    ($gen:path; $($rest:tt)*) => {
        $crate::cached_prop_hostfns!(@loop $gen; $($rest)*);
    };
    (@loop $gen:path;) => {};
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

            $crate::jsc_abi_extern! {
                #[allow(improper_ctypes)]
                {
                    #[link_name = concat!($TypeName, "__fromJS")]
                    safe fn __from_js(value: JSValue) -> *mut Payload;
                    #[link_name = concat!($TypeName, "__fromJSDirect")]
                    safe fn __from_js_direct(value: JSValue) -> *mut Payload;
                    #[link_name = concat!($TypeName, "__create")]
                    safe fn __create(global: *mut JSGlobalObject, ptr: *mut Payload) -> JSValue;
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
                __create(global.as_ptr(), ptr)
            }

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
