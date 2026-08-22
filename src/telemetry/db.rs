//! Database client spans (PostgreSQL, MySQL, SQLite, Redis).
//! https://opentelemetry.io/docs/specs/semconv/database/database-spans/

use core::ffi::c_void;

use crate::pool::{self, NativeSpan};
use crate::{Instrument, ScopeId, SpanKind, Value, rt};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum System {
    Postgres,
    MySql,
    Sqlite,
    Redis,
}

impl System {
    pub const fn name(self) -> &'static str {
        match self {
            System::Postgres => "postgresql",
            System::MySql => "mysql",
            System::Sqlite => "sqlite",
            System::Redis => "redis",
        }
    }
    pub const fn instrument(self) -> Instrument {
        match self {
            System::Postgres | System::MySql => Instrument::Sql,
            System::Sqlite => Instrument::Sqlite,
            System::Redis => Instrument::Redis,
        }
    }
    pub const fn default_port(self) -> u16 {
        match self {
            System::Postgres => 5432,
            System::MySql => 3306,
            System::Sqlite => 0,
            System::Redis => 6379,
        }
    }
}

pub struct ConnectionInfo<'a> {
    pub host: &'a [u8],
    pub port: u16,
    /// Database name (SQL), file (SQLite) or db index (Redis, as text).
    pub namespace: &'a [u8],
}

/// Why a query failed: `ty` becomes `error.type` (and
/// `db.response.status_code` when it looks like one), `message` the span
/// status description.
#[derive(Clone, Copy)]
pub struct DbError<'a> {
    pub ty: &'a [u8],
    pub message: &'a [u8],
}

/// Start a CLIENT span for one query/command. `NativeSpan::NONE` when disabled.
pub fn begin(global: *mut c_void, system: System, conn: &ConnectionInfo<'_>) -> NativeSpan {
    let stub = rt::start_leaf(global, system.instrument());
    if !stub.is_some() {
        return NativeSpan::NONE;
    }
    let limits = rt::limits();
    rt::with_local(global, |local| {
        pool::begin_with(
            &mut local.pool,
            stub,
            ScopeId::from(system.instrument()),
            system.name().as_bytes(),
            SpanKind::Client,
            |s| {
                if !stub.is_recording() {
                    return;
                }
                let l = &limits;
                s.push_attribute(b"db.system.name", &Value::Str(system.name().as_bytes()), l);
                if !conn.namespace.is_empty() {
                    s.push_attribute(b"db.namespace", &Value::Str(conn.namespace), l);
                }
                if !conn.host.is_empty() {
                    s.push_attribute(b"server.address", &Value::Str(conn.host), l);
                    if conn.port != 0 {
                        s.push_attribute(b"server.port", &Value::Int(conn.port as i64), l);
                    }
                }
            },
        )
    })
    .unwrap_or(NativeSpan::NONE)
}

/// Verbs recognised as `db.operation.name` when they lead a statement.
const SQL_VERBS: &[&str] = &[
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "WITH",
    "CREATE",
    "DROP",
    "ALTER",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "SET",
    "SHOW",
    "EXPLAIN",
    "PRAGMA",
    "VACUUM",
    "TRUNCATE",
    "MERGE",
    "REPLACE",
    "UPSERT",
    "CALL",
    "EXEC",
    "EXECUTE",
    "PREPARE",
    "DEALLOCATE",
    "COPY",
    "GRANT",
    "REVOKE",
    "ANALYZE",
    "ATTACH",
    "DETACH",
    "LISTEN",
    "NOTIFY",
    "UNLISTEN",
    "SAVEPOINT",
    "RELEASE",
    "LOCK",
    "UNLOCK",
    "USE",
    "DESCRIBE",
    "DESC",
    "START",
    "END",
    "REINDEX",
    "DECLARE",
    "FETCH",
    "CLOSE",
    "MOVE",
    "DO",
    "VALUES",
    "TABLE",
    "REFRESH",
    "CLUSTER",
    "COMMENT",
    "DISCARD",
    "RESET",
    "CHECKPOINT",
    "OPTIMIZE",
    "RENAME",
    "KILL",
    "FLUSH",
    "LOAD",
    "HANDLER",
    "IMPORT",
    "INSTALL",
    "UNINSTALL",
];

/// The leading SQL verb (`SELECT`, `INSERT`, …) if the statement starts with
/// one; used for the span name and `db.operation.name`.
pub fn sql_operation(sql: &[u8]) -> Option<&'static str> {
    let mut i = 0;
    // Skip whitespace and `(`; skip `--` line and `/* */` block comments.
    loop {
        while i < sql.len() && matches!(sql[i], b' ' | b'\t' | b'\n' | b'\r' | b'(') {
            i += 1;
        }
        if sql[i..].starts_with(b"--") {
            while i < sql.len() && sql[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if sql[i..].starts_with(b"/*") {
            i += bun_core::strings::index_of(&sql[i..], b"*/")? + 2;
            continue;
        }
        break;
    }
    let start = i;
    while i < sql.len() && sql[i].is_ascii_alphabetic() && i - start <= 10 {
        i += 1;
    }
    let word = &sql[start..i];
    if !(2..=10).contains(&word.len()) {
        return None;
    }
    if i < sql.len() && !matches!(sql[i], b' ' | b'\t' | b'\n' | b'\r' | b';' | b'(') {
        return None;
    }
    let first = word[0].to_ascii_uppercase();
    SQL_VERBS
        .iter()
        .copied()
        .find(|v| v.as_bytes()[0] == first && v.as_bytes().eq_ignore_ascii_case(word))
}

/// Finish a query span. `statement` is recorded as `db.query.text` when
/// statement capture is on.
pub fn end(
    global: *mut c_void,
    span: NativeSpan,
    statement: &[u8],
    operation: Option<&[u8]>,
    error: Option<DbError<'_>>,
) {
    if !span.is_some() {
        return;
    }
    let op: Option<&[u8]> = operation.or_else(|| sql_operation(statement).map(str::as_bytes));
    let capture = rt::capture_db_statement();
    let ended = rt::with_local(global, |local| {
        if let Some(o) = op {
            pool::with(&mut local.pool, span, |s| s.set_name(o));
        }
        pool::end(local, span, 0, |w| {
            if let Some(o) = op {
                w.attr("db.operation.name", o);
            }
            if capture && !statement.is_empty() {
                // Cap very large statements; collectors reject multi-MB attributes.
                w.attr(
                    "db.query.text",
                    crate::otlp::truncate_utf8(statement, 16 * 1024),
                );
            }
            if let Some(DbError { ty, message }) = error {
                w.attr_opt("error.type", ty);
                if !ty.is_empty() && ty.len() <= 8 && ty.iter().all(|c| c.is_ascii_alphanumeric()) {
                    w.attr("db.response.status_code", ty);
                }
                w.status(crate::StatusCode::Error, message);
            }
        })
    })
    .flatten();
    if let (Some(h), Some(e)) = (rt::hooks(), &ended) {
        if e.js_cell.is_some() {
            (h.release_cell)(e.js_cell);
        }
        if e.recorded {
            (h.after_record)(global);
        }
    }
}
