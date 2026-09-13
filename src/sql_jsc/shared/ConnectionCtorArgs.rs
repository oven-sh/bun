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
// (`normalizeSSLMode` in src/js/internal/sql/shared.ts) normalizes each
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
    pub ssl_mode: M,
    pub tls_config: SSLConfig,
    /// Moves into the connection.
    pub secure: Option<OwnedSslCtx>,
}

impl<M: SslModeArg> ConnectionCtorArgs<M> {
    /// Parses `arguments[0..=6]`. Returns `Ok(None)` when a JS exception is
    /// already pending and the caller should `return Ok(JSValue::ZERO)`.
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
        let modes = M::MODES;
        let ssl_mode = usize::try_from(arguments[5].to_int32())
            .ok()
            .and_then(|i| modes.get(i))
            .copied()
            .unwrap_or(modes[0]);

        let tls_object = arguments[6];
        let mut tls_config = SSLConfig::default();
        let mut secure: Option<OwnedSslCtx> = None;
        if ssl_mode != modes[0] {
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
            ssl_mode,
            tls_config,
            secure,
        }))
    }
}
