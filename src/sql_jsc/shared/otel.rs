use core::cell::Cell;

use bun_jsc::{JSGlobalObject, JSValue};
use bun_telemetry::NativeSpan;
pub use bun_telemetry::db::DbError;
use bun_telemetry::db::{ConnectionInfo, System};

/// `server.address`/`server.port` for a connection: the unix socket path when
/// set, else hostname and TCP port.
#[derive(Default)]
pub struct ServerAddress {
    pub host: Box<[u8]>,
    pub port: u16,
}

impl ServerAddress {
    pub fn new(hostname: &[u8], port: i32, unix_path: &[u8]) -> Self {
        if unix_path.is_empty() {
            Self {
                host: hostname.into(),
                port: u16::try_from(port).unwrap_or(0),
            }
        } else {
            Self {
                host: unix_path.into(),
                port: 0,
            }
        }
    }
}

/// The native CLIENT span for one SQL query. Every `end*` is first-call-wins.
#[derive(Default)]
pub struct QuerySpan(Cell<NativeSpan>);

impl QuerySpan {
    pub fn begin(&self, global: &JSGlobalObject, system: System, addr: &ServerAddress, db: &[u8]) {
        if !bun_telemetry::enabled(bun_telemetry::Instrument::Sql) {
            return;
        }
        self.0.set(bun_telemetry::db::begin(
            global.as_ptr().cast(),
            system,
            &ConnectionInfo {
                host: &addr.host,
                port: addr.port,
                namespace: db,
            },
        ));
    }

    #[inline]
    pub fn is_active(&self) -> bool {
        self.0.get().is_some()
    }

    #[inline]
    fn take(&self) -> Option<NativeSpan> {
        let span = self.0.replace(NativeSpan::NONE);
        span.is_some().then_some(span)
    }

    pub fn end(
        &self,
        global: &JSGlobalObject,
        statement: &bun_core::String,
        error: Option<DbError<'_>>,
    ) {
        if let Some(span) = self.take() {
            bun_telemetry::db::end(
                global.as_ptr().cast(),
                span,
                statement.to_utf8().slice(),
                None,
                error,
            );
        }
    }

    /// End with a `PostgresError`/`MySQLError`: `errno` (SQLSTATE / server
    /// error number) or `code` (`ERR_*`) becomes `error.type`.
    pub fn end_with_js_error(
        &self,
        global: &JSGlobalObject,
        statement: &bun_core::String,
        err: JSValue,
    ) {
        let Some(span) = self.take() else {
            return;
        };
        let details = ErrorDetails::of(global, err);
        let error = match &details {
            Ok(d) => DbError {
                ty: d.code.as_deref().unwrap_or(b"_OTHER"),
                message: d.message.as_ref().map_or(b"", |m| m.slice()),
                from_server: d.from_server,
            },
            Err(_) => DbError {
                ty: b"_OTHER",
                message: b"",
                from_server: false,
            },
        };
        bun_telemetry::db::end(
            global.as_ptr().cast(),
            span,
            statement.to_utf8().slice(),
            None,
            Some(error),
        );
        if let Err(e) = details {
            let _ = bun_jsc::task::report_error_or_terminate(global, e);
        }
    }
}

struct ErrorDetails {
    code: Option<Vec<u8>>,
    /// `code` came from `errno` (a status the server sent) rather than `code` (`ERR_*`).
    from_server: bool,
    message: Option<bun_core::ZigStringSlice>,
}

impl ErrorDetails {
    fn of(global: &JSGlobalObject, err: JSValue) -> bun_jsc::JsResult<Self> {
        let mut this = Self {
            code: None,
            from_server: false,
            message: None,
        };
        if !err.is_object() {
            return Ok(this);
        }
        for key in ["errno", "code"] {
            if let Some(c) = err.get(global, key)? {
                if c.is_string() {
                    this.code = Some(c.to_slice(global)?.slice().to_vec());
                } else if c.is_number() {
                    let mut buf = bun_core::fmt::ItoaBuf::new();
                    this.code = Some(bun_core::fmt::itoa(&mut buf, c.to_int32()).to_vec());
                }
            }
            if this.code.is_some() {
                this.from_server = key == "errno";
                break;
            }
        }
        if let Some(m) = err.get(global, "message")? {
            if m.is_string() {
                this.message = Some(m.to_slice(global)?);
            }
        }
        Ok(this)
    }
}
