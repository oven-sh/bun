//! Shared connection-constructor prologue for the Postgres and MySQL
//! `createConnection(hostname, port, username, password, database, sslMode,
//! tls, ...)` host functions, through the per-VM `SSL_CTX*` cache lookup.

use crate::jsc::{
    JSGlobalObject, JSValue, JsResult, VirtualMachine, VirtualMachineSqlExt as _,
    api::server_config::SSLConfig,
};
use bun_boringssl_sys::OwnedSslCtx;
use bun_uws as uws;

pub(crate) trait SslModeArg: Copy + PartialEq {
    /// Wire order of the JS-side enum; index 0 is `Disable`.
    const MODES: [Self; 5];
}

macro_rules! impl_ssl_mode_arg {
    ($ty:ty) => {
        impl SslModeArg for $ty {
            const MODES: [Self; 5] = [
                Self::Disable,
                Self::Prefer,
                Self::Require,
                Self::VerifyCa,
                Self::VerifyFull,
            ];
        }
    };
}
// Both drivers use the same five postgres-shaped modes: the JS side
// (`normalizeSSLMode` in src/js/internal/sql/options.ts) normalizes each
// driver's accepted ssl-mode spellings to this one wire enum, so MySQL's
// native ssl-mode vocabulary never crosses this boundary.
impl_ssl_mode_arg!(bun_sql::mysql::ssl_mode::SSLMode);
impl_ssl_mode_arg!(bun_sql::postgres::SSLMode);

pub(crate) struct ConnectionCtorArgs<M> {
    pub hostname_str: bun_core::String,
    pub port: i32,
    pub username_str: bun_core::String,
    pub password_str: bun_core::String,
    pub database_str: bun_core::String,
    pub path_str: bun_core::String,
    pub ssl_mode: M,
    pub tls_config: SSLConfig,
    /// Moves into the connection.
    pub secure: Option<OwnedSslCtx>,
    /// Zero disables the timer.
    pub idle_timeout_ms: u32,
    pub connection_timeout_ms: u32,
    pub max_lifetime_ms: u32,
}

fn timeout_ms(global_object: &JSGlobalObject, value: JSValue) -> JsResult<u32> {
    // `as` maps NaN to zero.
    Ok(value
        .to_number(global_object)?
        .clamp(0.0, f64::from(i32::MAX)) as u32)
}

impl<M: SslModeArg> ConnectionCtorArgs<M> {
    /// Parses `arguments[0..=6]`, `[8]` and `[11..=13]`. `Ok(None)`: a JS exception is pending.
    pub(crate) fn parse(
        global_object: &JSGlobalObject,
        vm: &mut VirtualMachine,
        arguments: &[JSValue],
    ) -> JsResult<Option<Self>> {
        let hostname_str = arguments[0].to_bun_string(global_object)?;
        let port = arguments[1].coerce::<i32>(global_object)?;
        let username_str = arguments[2].to_bun_string(global_object)?;
        let password_str = arguments[3].to_bun_string(global_object)?;
        let database_str = arguments[4].to_bun_string(global_object)?;
        let path_str = arguments[8].to_bun_string(global_object)?;
        let idle_timeout_ms = timeout_ms(global_object, arguments[11])?;
        let connection_timeout_ms = timeout_ms(global_object, arguments[12])?;
        let max_lifetime_ms = timeout_ms(global_object, arguments[13])?;
        // A C string from here on: the resolver, SNI and the certificate check would see the name up to the NUL.
        if bun_core::strings::contains_char(hostname_str.to_utf8().slice(), 0) {
            return Err(global_object
                .throw_invalid_arguments(format_args!("hostname must not contain null bytes")));
        }
        let modes = M::MODES;
        let Some(ssl_mode) = Some(arguments[5])
            .filter(|mode| mode.is_any_int())
            .and_then(|mode| usize::try_from(mode.to_int32()).ok())
            .and_then(|i| modes.get(i).copied())
        else {
            return Err(global_object.throw_invalid_arguments(format_args!(
                "sslMode must be an integer from 0 (disable) to 4 (verify-full)"
            )));
        };

        let tls_object = arguments[6];
        let mut tls_config = SSLConfig::default();
        let mut secure: Option<OwnedSslCtx> = None;
        if ssl_mode != modes[0] {
            tls_config = if tls_object.is_boolean() && tls_object.to_boolean() {
                SSLConfig::default()
            } else if tls_object.is_object() {
                match SSLConfig::from_js(global_object, tls_object) {
                    Ok(opt) => opt.unwrap_or_default(),
                    Err(_) => return Ok(None),
                }
            } else {
                return Err(global_object
                    .throw_invalid_arguments(format_args!("tls must be a boolean or an object")));
            };

            if global_object.has_exception() {
                return Ok(None);
            }

            // We always request the cert so we can verify it and manually
            // abort if the hostname doesn't match. Built here (not at STARTTLS
            // time) so cert/CA errors throw synchronously; the per-VM weak
            // `SSLContextCache` shares one `SSL_CTX*` per distinct config
            // across pooled connections and reconnects.
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

        Ok(Some(Self {
            hostname_str,
            port,
            username_str,
            password_str,
            database_str,
            path_str,
            ssl_mode,
            tls_config,
            secure,
            idle_timeout_ms,
            connection_timeout_ms,
            max_lifetime_ms,
        }))
    }
}
