//! Shared `createInstance` argument parsing for the SQL connection bindings.
//!
//! `PostgresSQLConnection::call` and `JSMySQLConnection::create_instance` receive the
//! same 15 leading JS arguments; [`parse`] owns the one copy of that decoding — including
//! TLS `SSL_CTX` creation, its cleanup guard for early-return paths, and the null-byte
//! injection check — so the two drivers can't drift. Driver-specific arguments (MySQL's
//! `allowPublicKeyRetrieval`, argument 15) stay at the call sites.
//!
//! [`verify_tls_server`] is the matching post-handshake half: the one copy of the
//! server-certificate / hostname verification both drivers run after the TLS handshake.

use crate::jsc::api::server_config::SSLConfig;
use crate::jsc::{
    CallFrame, JSGlobalObject, JSValue, JsResult, VirtualMachine, VirtualMachineSqlExt as _,
};
use bun_core::{OwnedString, ZigStringSlice, strings};
use bun_uws as uws;

/// `bun_sql::postgres::SSLMode` and `bun_sql::mysql::ssl_mode::SSLMode` are identical
/// `#[repr(u8)]` enums; this trait lets [`parse`] produce whichever one the caller stores.
pub(crate) trait SslModeArg: Copy + PartialEq {
    /// Variants in discriminant order (`Disable = 0` .. `VerifyFull = 4`).
    const ALL: [Self; 5];

    /// `arguments[5]` — out-of-range values fall back to `Disable`.
    fn from_i32(value: i32) -> Self {
        let [disable, prefer, require, verify_ca, verify_full] = Self::ALL;
        match value {
            1 => prefer,
            2 => require,
            3 => verify_ca,
            4 => verify_full,
            _ => disable,
        }
    }

    fn is_disable(self) -> bool {
        self == Self::ALL[0]
    }
}

macro_rules! impl_ssl_mode_arg {
    ($($t:ty),+ $(,)?) => {$(
        impl SslModeArg for $t {
            const ALL: [Self; 5] =
                [Self::Disable, Self::Prefer, Self::Require, Self::VerifyCa, Self::VerifyFull];
        }
    )+};
}
impl_ssl_mode_arg!(
    bun_sql::postgres::SSLMode,
    bun_sql::mysql::ssl_mode::SSLMode
);

type TlsPair = (Option<*mut uws::SslCtx>, SSLConfig);

/// Owns `(secure, tls_config)` until the caller transfers them into its connection struct
/// via `scopeguard::ScopeGuard::into_inner`. Dropping the guard instead (any early-return
/// path) releases the `SSL_CTX` ref and the config — the Rust spelling of the Zig `errdefer`.
pub(crate) type TlsGuard = scopeguard::ScopeGuard<TlsPair, fn(TlsPair)>;

fn release_tls((secure, tls_config): TlsPair) {
    if let Some(s) = secure {
        // SAFETY: `s` came from `ssl_ctx_cache().get_or_create_opts()`; this guard owns
        // the one outstanding ref.
        unsafe { bun_boringssl_sys::SSL_CTX_free(s) };
    }
    drop(tls_config);
}

/// Post-TLS-handshake server verification shared by `PostgresSQLConnection::on_handshake`
/// and `MySQLConnection::do_handshake`.
///
/// The caller has already established that its SSL mode is `VerifyCa` or `VerifyFull` and
/// that `reject_unauthorized` is set; `verify_full` selects the additional hostname
/// identity check. Returns `false` when the connection must be rejected — failure
/// reporting stays at the call site.
pub(crate) fn verify_tls_server(
    verify_full: bool,
    tls_config: &SSLConfig,
    native_handle: Option<*mut core::ffi::c_void>,
    error_no: i32,
) -> bool {
    if error_no != 0 {
        return false;
    }
    if !verify_full {
        return true;
    }
    // VerifyFull additionally requires the certificate identity to match the intended
    // host. Absence of a configured server name is not a license to skip the check —
    // fail closed.
    let servername = tls_config.server_name();
    if servername.is_null() {
        return false;
    }
    // SAFETY: the native handle of a connected TLS socket is `SSL*`, live for the
    // duration of the handshake callback.
    let ssl_ptr: *mut bun_boringssl_sys::SSL =
        native_handle.map_or(core::ptr::null_mut(), |p| p.cast());
    let Some(ssl) = (unsafe { ssl_ptr.as_mut() }) else {
        return false;
    };
    // SAFETY: `servername` is a NUL-terminated C string owned by `tls_config` for the
    // connection lifetime.
    let hostname = unsafe { bun_core::ffi::cstr(servername) }.to_bytes();
    bun_boringssl::check_server_identity(ssl, hostname)
}

/// A string argument decoded to UTF-8 exactly once, shared by the null-byte
/// check in [`parse`] and by both drivers' connection buffers — so neither
/// caller re-runs the conversion.
pub(crate) struct Utf8Arg {
    /// Declared before `_source` so it drops first: on the all-ASCII fast path
    /// it is a `ZigStringSlice::Static` borrow of `_source`'s bytes.
    utf8: ZigStringSlice,
    /// Keeps the backing `WTFStringImpl` alive while `utf8` may borrow its bytes.
    _source: OwnedString,
}

impl Utf8Arg {
    fn new(source: OwnedString) -> Self {
        let utf8 = source.to_utf8_without_ref();
        Self {
            utf8,
            _source: source,
        }
    }

    /// The UTF-8 bytes.
    pub(crate) fn slice(&self) -> &[u8] {
        self.utf8.slice()
    }

    /// Consume into owned bytes — moves the conversion's buffer when it
    /// allocated one, copies the borrowed view otherwise.
    pub(crate) fn into_boxed_bytes(self) -> Box<[u8]> {
        self.utf8.into_vec().into_boxed_slice()
    }
}

/// The 15 parsed `createInstance` arguments common to Postgres and MySQL.
pub(crate) struct ConnectionArgs<Mode> {
    pub hostname: OwnedString,
    pub port: i32,
    pub username: Utf8Arg,
    pub password: Utf8Arg,
    pub database: Utf8Arg,
    pub options: Utf8Arg,
    pub path: Utf8Arg,
    pub ssl_mode: Mode,
    pub tls: TlsGuard,
    pub on_connect: JSValue,
    pub on_close: JSValue,
    pub idle_timeout: i32,
    pub connection_timeout: i32,
    pub max_lifetime: i32,
    pub use_unnamed_prepared_statements: bool,
}

/// Decode `arguments[0..=14]`, building the TLS `SSL_CTX` when `sslMode != Disable`.
///
/// `Ok(None)` means a JS exception is already pending and the caller must return
/// `JSValue::ZERO` (the Zig `return .zero` paths).
pub(crate) fn parse<Mode: SslModeArg>(
    vm: &mut VirtualMachine,
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<Option<ConnectionArgs<Mode>>> {
    let arguments = callframe.arguments();

    let hostname = OwnedString::new(arguments[0].to_bun_string(global_object)?);
    let port = arguments[1].coerce::<i32>(global_object)?;
    let username = Utf8Arg::new(OwnedString::new(arguments[2].to_bun_string(global_object)?));
    let password = Utf8Arg::new(OwnedString::new(arguments[3].to_bun_string(global_object)?));
    let database = Utf8Arg::new(OwnedString::new(arguments[4].to_bun_string(global_object)?));
    let ssl_mode = Mode::from_i32(arguments[5].to_int32());

    let tls_object = arguments[6];
    let mut tls_config = SSLConfig::default();
    let mut secure: Option<*mut uws::SslCtx> = None;
    if !ssl_mode.is_disable() {
        tls_config = if tls_object.is_boolean() && tls_object.to_boolean() {
            SSLConfig::default()
        } else if tls_object.is_object() {
            match SSLConfig::from_js(&mut *vm, global_object, tls_object) {
                Ok(opt) => opt.unwrap_or_default(),
                Err(_) => return Ok(None),
            }
        } else {
            return Err(global_object
                .throw_invalid_arguments(format_args!("tls must be a boolean or an object")));
        };

        if global_object.has_exception() {
            drop(tls_config);
            return Ok(None);
        }

        // We always request the cert so we can verify it, and we manually abort the
        // connection if the hostname doesn't match. Built here — not at STARTTLS time — so
        // cert/CA errors throw synchronously; the per-VM weak `SSLContextCache` shares one
        // `SSL_CTX*` per distinct config across pooled connections / reconnects.
        let mut err = uws::create_bun_socket_error_t::none;
        secure = vm
            .ssl_ctx_cache()
            .get_or_create_opts(&tls_config.as_usockets_for_client_verification(), &mut err);
        if secure.is_none() {
            drop(tls_config);
            return Err(
                global_object.throw_value(crate::jsc::create_bun_socket_error_to_js(
                    err,
                    global_object,
                )),
            );
        }
    }

    // Covers the throwing parses / null-byte checks below and everything the caller does
    // until ownership transfers into the connection struct.
    let tls: TlsGuard = scopeguard::guard((secure, tls_config), release_tls as fn(TlsPair));

    let options = Utf8Arg::new(OwnedString::new(arguments[7].to_bun_string(global_object)?));
    let path = Utf8Arg::new(OwnedString::new(arguments[8].to_bun_string(global_object)?));

    // Reject null bytes in connection parameters to prevent wire-protocol parameter
    // injection (null bytes act as field terminators in both the Postgres `key\0value\0`
    // startup message and the MySQL handshake).
    for (s, name) in [
        (&username, "username"),
        (&password, "password"),
        (&database, "database"),
        (&path, "path"),
    ] {
        let utf8 = s.slice();
        if !utf8.is_empty() && strings::index_of_char(utf8, 0).is_some() {
            return Err(global_object
                .throw_invalid_arguments(format_args!("{name} must not contain null bytes")));
        }
    }

    Ok(Some(ConnectionArgs {
        hostname,
        port,
        username,
        password,
        database,
        options,
        path,
        ssl_mode,
        tls,
        on_connect: arguments[9],
        on_close: arguments[10],
        idle_timeout: arguments[11].to_int32(),
        connection_timeout: arguments[12].to_int32(),
        max_lifetime: arguments[13].to_int32(),
        use_unnamed_prepared_statements: arguments[14].as_boolean(),
    }))
}
