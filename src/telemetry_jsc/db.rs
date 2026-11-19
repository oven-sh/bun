//! `Bun.sql`, `Bun.redis`, bun:sqlite and node:sqlite.

use core::ffi::{CStr, c_char};

use bun_jsc::{JSGlobalObject, JSValue};
use bun_removable_features::removable_definition;
use bun_telemetry::db::{self, QUERY_TEXT_MAX, sql_operation};
use bun_telemetry::{Instrument, Record, SpanKind, capture_db_statement};

pub use bun_telemetry::db::{ConnectionInfo, DbError, System, describe_redis_command};

use crate::engine;
use crate::native::{NativeSpan, SpanCell};
use crate::outcome::Outcome;

#[inline(always)]
pub fn begin<'a>(
    global: &JSGlobalObject,
    system: System,
    connection: impl FnOnce() -> ConnectionInfo<'a>,
    describe_statement: impl FnOnce(&mut Record),
) -> NativeSpan {
    NativeSpan::start(global, system.instrument(), SpanKind::Client, |r| {
        db::describe_system(r, system);
        db::describe_connection(r, &connection());
        describe_statement(r);
    })
}

/// An error that a driver of Bun's made: `errno` is the status that the server sent, `code` is Bun's.
pub struct DriverError<'a>(pub &'a JSGlobalObject, pub JSValue);

impl Outcome for DriverError<'_> {
    fn record(self, record: &mut Record) {
        let description = engine::describe_passing_error(self.0, self.1);
        let (errno, code) = (description.errno.to_utf8(), description.ty.to_utf8());
        Outcome::record(
            DbError {
                ty: if errno.is_empty() { &code } else { &errno },
                message: &description.message.to_utf8(),
                from_server: !errno.is_empty(),
            },
            record,
        );
    }
}

/// Where a connection of `Bun.sql` goes.
#[derive(Default)]
pub struct Server {
    address: Box<[u8]>,
    port: u16,
    database: Box<[u8]>,
}

impl Server {
    pub fn new(hostname: &[u8], port: i32, unix_path: &[u8], database: &[u8]) -> Server {
        let (address, port) = match unix_path {
            b"" => (hostname, u16::try_from(port).unwrap_or(0)),
            path => (path, 0),
        };
        Server {
            address: address.into(),
            port,
            database: database.into(),
        }
    }
}

/// The span of a query of `Bun.sql`.
pub struct QuerySpan(SpanCell);

impl QuerySpan {
    /// Where the query is made: the pool may run it from an event of a socket, which has no active span.
    #[inline(always)]
    pub fn begin(global: &JSGlobalObject, system: System) -> QuerySpan {
        let (instrument, kind) = (system.instrument(), SpanKind::Client);
        QuerySpan(
            NativeSpan::start(global, instrument, kind, |r| db::describe_system(r, system)).into(),
        )
    }

    #[inline(always)]
    pub fn runs_on(&self, server: &Server) {
        self.0.describe(|r| {
            let connection = ConnectionInfo {
                host: &server.address,
                port: server.port,
                namespace: &server.database,
            };
            db::describe_connection(r, &connection);
        });
    }

    #[inline(always)]
    pub fn end(&self, statement: &bun_core::String) {
        self.0.take().end_with(|r| describe_sql(r, statement));
    }

    #[inline(always)]
    pub fn fail(&self, global: &JSGlobalObject, statement: &bun_core::String, error: JSValue) {
        self.0.take().end_with(|r| {
            describe_sql(r, statement);
            DriverError(global, error).record(r);
        });
    }
}

fn describe_sql(record: &mut Record, statement: &bun_core::String) {
    let operation = if statement.is_utf16() {
        sql_operation(statement.utf16())
    } else {
        sql_operation(statement.byte_slice())
    };
    // A code unit takes a byte or more, so this is over the limit if the statement is.
    let text = capture_db_statement().then(|| statement.trunc(QUERY_TEXT_MAX + 1));
    let text = text.as_ref().map(|text| text.to_utf8());
    let text = text.as_deref().unwrap_or_default();
    db::describe_statement(record, operation.map(str::as_bytes), text);
}

#[unsafe(no_mangle)]
static Bun__Telemetry__sqliteBit: u32 = Instrument::Sqlite.bit();

/// The text is recorded now: script that the statement calls may finalize it.
///
/// # Safety
/// `file` and `sql` are null or C strings.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Telemetry__sqliteBegin(
    global: &JSGlobalObject,
    file: *const c_char,
    sql: *const c_char,
) -> NativeSpan {
    removable_definition!(Telemetry, Bun__Telemetry__sqliteBegin);
    let c_string = |s: *const c_char| match s.is_null() {
        true => &b""[..],
        // SAFETY: forwarded.
        false => unsafe { CStr::from_ptr(s) }.to_bytes(),
    };
    let connection = || ConnectionInfo {
        host: b"",
        port: 0,
        namespace: bun_paths::basename(c_string(file)),
    };
    begin(global, System::Sqlite, connection, |r| {
        let sql = c_string(sql);
        db::describe_statement(r, sql_operation(sql).map(str::as_bytes), sql);
    })
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Telemetry__sqliteEnd(global: &JSGlobalObject, span: NativeSpan) {
    removable_definition!(Telemetry, Bun__Telemetry__sqliteEnd);
    span.end_with(|r| {
        if let Some(error) = engine::describe_pending_exception(global) {
            let code = error.ty.to_utf8();
            if code.starts_with(b"SQLITE_") {
                r.attr("db.response.status_code", &*code);
            }
            error.record(r);
        }
    });
}
