//! Stub surface for `.classes.ts` / bindgen-generated option structs and
//! per-class cached-accessor modules.
//!
//! The real code is emitted by `src/codegen/generate-classes.ts` (Zig output:
//! `ZigGeneratedClasses.zig`). Until that script grows a `.rs` backend, this
//! file hand-stubs the handful of shapes that downstream crates name directly
//! (`bun_jsc::generated::{SocketConfig*, SSLConfig*, JSTimeout, JSImmediate,
//! JSBlob, JSResponse, JSRequest}`). All bodies `todo!()` — these exist purely
//! so dependents type-check during the port.
//!
//! Symbol-naming contract (kept in sync with generate-classes.ts):
//!   `${T}Prototype__${name}GetCachedValue(JSValue) -> JSValue`
//!   `${T}Prototype__${name}SetCachedValue(JSValue, *JSGlobalObject, JSValue)`
//!   `${T}__fromJS` / `${T}__fromJSDirect` / `${T}__create` / `${T}__getConstructor`

#![allow(dead_code, unused_variables, non_snake_case)]

use crate::{JSGlobalObject, JSValue, JsResult};

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

// Shorthand for the bindgen string payload. The real generator hands back a
// `bun.String` / `WTFStringImpl`; downstream code only calls `.length()` /
// `.to_utf8()` / `.to_owned_slice_z()` on it, all of which `bun_string::String`
// already provides.
pub type GenString = bun_string::String;

// ──────────────────────────────────────────────────────────────────────────
// SocketConfig (src/runtime/socket/socket.classes.ts → bindgen)
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Default, Clone, Copy)]
pub enum SocketConfigHandlersBinaryType {
    Arraybuffer,
    #[default]
    Buffer,
    Uint8array,
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

impl SocketConfigHandlers {
    pub fn from_js(_global: &JSGlobalObject, _value: JSValue) -> JsResult<Self> {
        // TODO(port): codegen — re-run generate-classes.ts with .rs output.
        todo!("generated::SocketConfigHandlers::from_js")
    }
}

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

impl SocketConfig {
    pub fn from_js(_global: &JSGlobalObject, _value: JSValue) -> JsResult<Self> {
        // TODO(port): codegen — re-run generate-classes.ts with .rs output.
        todo!("generated::SocketConfig::from_js")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SSLConfig (shared by SocketConfig.tls and Bun.serve TLS options)
// ──────────────────────────────────────────────────────────────────────────

pub enum SSLConfigAlpnProtocols {
    None,
    String(GenVal<GenString>),
    Buffer(GenVal<JSValue>),
}

/// `string | Buffer | BunFile` element of an SSL file-ish option.
pub enum SSLConfigSingleFile {
    String(GenVal<GenString>),
    Buffer(GenVal<JSValue>),
    File(GenVal<JSValue>),
}

/// `string | Buffer | BunFile | Array<...>` — the full file-ish option.
pub enum SSLConfigFile {
    None,
    String(GenVal<GenString>),
    Buffer(GenVal<JSValue>),
    File(GenVal<JSValue>),
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

impl SSLConfig {
    pub fn from_js(_global: &JSGlobalObject, _value: JSValue) -> JsResult<Self> {
        // TODO(port): codegen — re-run generate-classes.ts with .rs output.
        todo!("generated::SSLConfig::from_js")
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

/// Expands to a `pub mod $mod_name` containing the standard
/// `from_js` / `from_js_direct` / `to_js` / `get_constructor` quartet plus a
/// cached-accessor pair for every listed property. Kept crate-private; callers
/// outside this crate use [`crate::codegen_cached_accessors!`] which wraps the
/// same extern contract without the module scaffolding.
macro_rules! js_class_module {
    (
        $mod_name:ident = $TypeName:literal { $( $prop:ident ),* $(,)? }
    ) => {
        pub mod $mod_name {
            use $crate::{JSGlobalObject, JSValue};
            $crate::codegen_cached_accessors!($TypeName; $( $prop ),*);

            pub fn from_js(_value: JSValue) -> ::core::option::Option<*mut ()> {
                // TODO(port): codegen — re-run generate-classes.ts with .rs output.
                // Must NOT silently return `None` (PORTING.md §Forbidden patterns):
                // a valid wrapper would be misreported as a type mismatch.
                todo!(concat!("generated::", stringify!($mod_name), "::from_js"))
            }
            pub fn from_js_direct(_value: JSValue) -> ::core::option::Option<*mut ()> {
                todo!(concat!("generated::", stringify!($mod_name), "::from_js_direct"))
            }
            pub fn to_js(_ptr: *mut (), _global: &JSGlobalObject) -> JSValue {
                todo!(concat!("generated::", stringify!($mod_name), "::to_js"))
            }
            pub fn get_constructor(_global: &JSGlobalObject) -> JSValue {
                todo!(concat!("generated::", stringify!($mod_name), "::get_constructor"))
            }
        }
    };
}

js_class_module!(JSTimeout   = "Timeout"   { callback, arguments, idleTimeout, repeat, idleStart });
js_class_module!(JSImmediate = "Immediate" { callback, arguments });
js_class_module!(JSBlob      = "Blob"      { name, stream });
js_class_module!(JSResponse  = "Response"  { body, headers, url, statusText, stream });
js_class_module!(JSRequest   = "Request"   { body, headers, url, signal, stream });

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     ZigGeneratedClasses.zig (generated; not checked in)
//   confidence: low (hand-stubbed)
//   todos:      replace with `.rs` backend in src/codegen/generate-classes.ts
// ──────────────────────────────────────────────────────────────────────────
