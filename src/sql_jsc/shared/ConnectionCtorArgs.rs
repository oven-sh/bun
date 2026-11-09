//! Shared connection-constructor prologue for the Postgres and MySQL
//! `createConnection(hostname, port, username, password, database, sslMode,
//! tls, ...)` host functions, through the per-VM `SSL_CTX*` cache lookup.

use crate::jsc::{
    JSGlobalObject, JSValue, JsResult, VirtualMachine, VirtualMachineSqlExt as _,
    api::server_config::SSLConfig,
};
use bun_boringssl_sys::OwnedSslCtx;
use bun_sql::shared::SSLMode;
use bun_uws as uws;

const SSL_MODES: [SSLMode; 5] = [
    SSLMode::Disable,
    SSLMode::Prefer,
    SSLMode::Require,
    SSLMode::VerifyCa,
    SSLMode::VerifyFull,
];

pub(crate) struct ConnectionCtorArgs {
    pub ssl_mode: SSLMode,
    pub tls_config: SSLConfig,
    /// Moves into the connection.
    pub secure: Option<OwnedSslCtx>,
    /// Zero disables the timer.
    pub idle_timeout_ms: u32,
    pub connection_timeout_ms: u32,
    pub max_lifetime_ms: u32,
}

fn timeout_ms(value: f64) -> u32 {
    // `as` maps NaN to zero.
    value.clamp(0.0, f64::from(i32::MAX)) as u32
}

impl ConnectionCtorArgs {
    /// `ssl_mode` is an index of `SSL_MODES`. `Ok(None)`: a JS exception is pending.
    pub(crate) fn parse(
        global_object: &JSGlobalObject,
        vm: &mut VirtualMachine,
        hostname: &[u8],
        ssl_mode: u8,
        tls_object: JSValue,
        idle_timeout: f64,
        connection_timeout: f64,
        max_lifetime: f64,
    ) -> JsResult<Option<Self>> {
        // A C string from here on: the resolver, SNI and the certificate check would see the name up to the NUL.
        if bun_core::strings::contains_char(hostname, 0) {
            return Err(global_object
                .throw_invalid_arguments(format_args!("hostname must not contain null bytes")));
        }
        let ssl_mode = SSL_MODES[usize::from(ssl_mode)];

        let mut tls_config = SSLConfig::default();
        let mut secure: Option<OwnedSslCtx> = None;
        if ssl_mode != SSLMode::Disable {
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
            ssl_mode,
            tls_config,
            secure,
            idle_timeout_ms: timeout_ms(idle_timeout),
            connection_timeout_ms: timeout_ms(connection_timeout),
            max_lifetime_ms: timeout_ms(max_lifetime),
        }))
    }
}
