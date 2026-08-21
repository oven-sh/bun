//! Database client spans (PostgreSQL, MySQL, SQLite, Redis).
//! https://opentelemetry.io/docs/specs/semconv/database/database-spans/

use core::ffi::c_void;

use crate::pool::{self, NativeSpan};
use crate::{DEFAULT_LIMITS, Instrument, ScopeId, SpanKind, StatusCode, Value, rt};

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

/// Start a CLIENT span for one query/command. `NativeSpan::NONE` when disabled.
pub fn begin(global: *mut c_void, system: System, conn: &ConnectionInfo<'_>) -> NativeSpan {
    let stub = rt::start_leaf(global, system.instrument());
    if !stub.is_some() {
        return NativeSpan::NONE;
    }
    let span = pool::begin(
        stub,
        ScopeId::from(system.instrument()),
        system.name().as_bytes(),
        SpanKind::Client,
    );
    if stub.is_recording() {
        let l = &DEFAULT_LIMITS;
        pool::with(span, |s| {
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
        });
    }
    span
}

/// The leading SQL verb (`SELECT`, `INSERT`, …) if the statement starts with
/// one; used for the span name and `db.operation.name`.
pub fn sql_operation(sql: &[u8]) -> Option<[u8; 16]> {
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
            match crate_index_of(&sql[i..], b"*/") {
                Some(j) => i += j + 2,
                None => return None,
            }
            continue;
        }
        break;
    }
    let start = i;
    while i < sql.len() && sql[i].is_ascii_alphabetic() && i - start < 16 {
        i += 1;
    }
    let len = i - start;
    if !(2..=10).contains(&len) {
        return None;
    }
    if i < sql.len() && !matches!(sql[i], b' ' | b'\t' | b'\n' | b'\r' | b';' | b'(') {
        return None;
    }
    let mut out = [0u8; 16];
    for (k, c) in sql[start..i].iter().enumerate() {
        out[k] = c.to_ascii_uppercase();
    }
    match &out[..len] {
        b"SELECT" | b"INSERT" | b"UPDATE" | b"DELETE" | b"WITH" | b"CREATE" | b"DROP"
        | b"ALTER" | b"BEGIN" | b"COMMIT" | b"ROLLBACK" | b"SET" | b"SHOW" | b"EXPLAIN"
        | b"PRAGMA" | b"VACUUM" | b"TRUNCATE" | b"MERGE" | b"REPLACE" | b"UPSERT" | b"CALL"
        | b"EXEC" | b"EXECUTE" | b"PREPARE" | b"DEALLOCATE" | b"COPY" | b"GRANT" | b"REVOKE"
        | b"ANALYZE" | b"ATTACH" | b"DETACH" | b"LISTEN" | b"NOTIFY" | b"UNLISTEN"
        | b"SAVEPOINT" | b"RELEASE" | b"LOCK" | b"UNLOCK" | b"USE" | b"DESCRIBE" | b"DESC"
        | b"START" | b"END" | b"REINDEX" | b"DECLARE" | b"FETCH" | b"CLOSE" | b"MOVE" | b"DO"
        | b"VALUES" | b"TABLE" | b"REFRESH" | b"CLUSTER" | b"COMMENT" | b"DISCARD" | b"RESET"
        | b"CHECKPOINT" | b"OPTIMIZE" | b"RENAME" | b"KILL" | b"FLUSH" | b"LOAD" | b"HANDLER"
        | b"IMPORT" | b"INSTALL" | b"UNINSTALL" => Some(out),
        _ => None,
    }
}

fn crate_index_of(hay: &[u8], needle: &[u8]) -> Option<usize> {
    bun_core::strings::index_of(hay, needle)
}

#[inline]
fn op_len(op: &[u8; 16]) -> usize {
    bun_core::strings::index_of_char_usize(op, 0).unwrap_or(16)
}

/// Finish a query span. `statement` is recorded as `db.query.text` when
/// statement capture is on; `error` = (error.type, message).
pub fn end(span: NativeSpan, statement: &[u8], operation: Option<&[u8]>, error: Option<(&[u8], &[u8])>) {
    if !span.is_some() {
        return;
    }
    let op_buf;
    let op: Option<&[u8]> = match operation {
        Some(o) => Some(o),
        None => match sql_operation(statement) {
            Some(b) => {
                op_buf = b;
                Some(&op_buf[..op_len(&op_buf)])
            }
            None => None,
        },
    };
    if let Some(o) = op {
        pool::with(span, |s| s.set_name(o));
    }
    let capture = rt::capture_db_statement();
    pool::end(span, 0, |w| {
        if let Some(o) = op {
            w.attr("db.operation.name", o);
        }
        if capture && !statement.is_empty() {
            // Cap very large statements; collectors reject multi-MB attributes.
            let s = if statement.len() > 16 * 1024 {
                &statement[..16 * 1024]
            } else {
                statement
            };
            w.attr("db.query.text", s);
        }
        if let Some((ty, msg)) = error {
            w.attr_opt("error.type", ty);
            if !ty.is_empty() && ty.iter().all(|c| c.is_ascii_alphanumeric()) && ty.len() <= 8 {
                w.attr("db.response.status_code", ty);
            }
            w.status(StatusCode::Error, msg);
        }
    });
    if let Some(h) = rt::hooks() {
        (h.after_record)();
    }
}
