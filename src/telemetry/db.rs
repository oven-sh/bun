//! Database client spans (PostgreSQL, MySQL, SQLite, Redis).
//! https://opentelemetry.io/docs/specs/semconv/database/database-spans/

use core::ffi::c_void;

use crate::pool::{self, NativeSpan};
use crate::{Instrument, SpanKind, Value, rt};

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
    /// `error.type`: SQLSTATE, driver error code, RESP error prefix, …
    pub ty: &'a [u8],
    pub message: &'a [u8],
    /// `ty` is a status the database itself returned (`db.response.status_code`)
    /// rather than a client-side condition (connection closed, …).
    pub from_server: bool,
}

/// Start a CLIENT span for one query/command. `NativeSpan::NONE` when disabled.
pub fn begin(global: *mut c_void, system: System, conn: &ConnectionInfo<'_>) -> NativeSpan {
    let stub = rt::start_leaf(global, system.instrument());
    // A query span is a leaf that is never made active: one that does not
    // record has nothing to propagate either, so it takes no slot.
    if !stub.is_recording() {
        return NativeSpan::NONE;
    }
    rt::begin_pooled(
        global,
        system.instrument(),
        stub,
        // semconv span name is `{operation} {target}`; the operation is
        // prepended at end(). Target: namespace, else the system name.
        if conn.namespace.is_empty() {
            system.name().as_bytes()
        } else {
            conn.namespace
        },
        SpanKind::Client,
        |s| {
            let l = &crate::state().limits;
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
}

bun_core::comptime_string_map! {
    /// Leading SQL verbs recognised for the span name / `db.operation.name`
    /// (lower-case keys for `get_ascii_case_insensitive`; value = canonical).
    static SQL_VERBS: &'static str = {
        b"select" => "SELECT",
        b"insert" => "INSERT",
        b"update" => "UPDATE",
        b"delete" => "DELETE",
        b"with" => "WITH",
        b"create" => "CREATE",
        b"drop" => "DROP",
        b"alter" => "ALTER",
        b"begin" => "BEGIN",
        b"commit" => "COMMIT",
        b"rollback" => "ROLLBACK",
        b"set" => "SET",
        b"show" => "SHOW",
        b"explain" => "EXPLAIN",
        b"pragma" => "PRAGMA",
        b"vacuum" => "VACUUM",
        b"truncate" => "TRUNCATE",
        b"merge" => "MERGE",
        b"replace" => "REPLACE",
        b"upsert" => "UPSERT",
        b"call" => "CALL",
        b"exec" => "EXEC",
        b"execute" => "EXECUTE",
        b"prepare" => "PREPARE",
        b"deallocate" => "DEALLOCATE",
        b"copy" => "COPY",
        b"grant" => "GRANT",
        b"revoke" => "REVOKE",
        b"analyze" => "ANALYZE",
        b"attach" => "ATTACH",
        b"detach" => "DETACH",
        b"listen" => "LISTEN",
        b"notify" => "NOTIFY",
        b"unlisten" => "UNLISTEN",
        b"savepoint" => "SAVEPOINT",
        b"release" => "RELEASE",
        b"lock" => "LOCK",
        b"unlock" => "UNLOCK",
        b"use" => "USE",
        b"describe" => "DESCRIBE",
        b"desc" => "DESC",
        b"start" => "START",
        b"end" => "END",
        b"reindex" => "REINDEX",
        b"declare" => "DECLARE",
        b"fetch" => "FETCH",
        b"close" => "CLOSE",
        b"move" => "MOVE",
        b"do" => "DO",
        b"values" => "VALUES",
        b"table" => "TABLE",
        b"refresh" => "REFRESH",
        b"cluster" => "CLUSTER",
        b"comment" => "COMMENT",
        b"discard" => "DISCARD",
        b"reset" => "RESET",
        b"checkpoint" => "CHECKPOINT",
        b"optimize" => "OPTIMIZE",
        b"rename" => "RENAME",
        b"kill" => "KILL",
        b"flush" => "FLUSH",
        b"load" => "LOAD",
        b"handler" => "HANDLER",
        b"import" => "IMPORT",
        b"install" => "INSTALL",
        b"uninstall" => "UNINSTALL",
    };
}

/// A Latin-1/UTF-8 byte or a UTF-16 code unit read as ASCII. [`sql_operation`]
/// only matches ASCII, so every other unit reads as one opaque byte.
pub trait CodeUnit: Copy {
    fn ascii(self) -> u8;
    /// Index of the first `*/` in `s`.
    fn comment_close(s: &[Self]) -> Option<usize>;
}
impl CodeUnit for u8 {
    #[inline]
    fn ascii(self) -> u8 {
        self
    }
    fn comment_close(s: &[u8]) -> Option<usize> {
        bun_core::strings::index_of(s, b"*/")
    }
}
impl CodeUnit for u16 {
    #[inline]
    fn ascii(self) -> u8 {
        if self < 0x80 { self as u8 } else { 0xFF }
    }
    fn comment_close(s: &[u16]) -> Option<usize> {
        let mut i = 0;
        loop {
            i += bun_core::strings::index_of_any16(&s[i..], &[u16::from(b'*')])?;
            if s.get(i + 1) == Some(&u16::from(b'/')) {
                return Some(i);
            }
            i += 1;
        }
    }
}

/// The leading SQL verb (`SELECT`, `INSERT`, …) if the statement starts with
/// one; used for the span name and `db.operation.name`.
pub fn sql_operation<C: CodeUnit>(sql: &[C]) -> Option<&'static str> {
    let at = |i: usize| sql.get(i).map(|c| c.ascii());
    let mut i = 0;
    // Skip whitespace and `(`; skip `--` line and `/* */` block comments.
    loop {
        while matches!(at(i), Some(b' ' | b'\t' | b'\n' | b'\r' | b'(')) {
            i += 1;
        }
        match (at(i), at(i + 1)) {
            // `--` (and MySQL's `#`) line comments
            (Some(b'-'), Some(b'-')) | (Some(b'#'), _) => {
                while i < sql.len() && at(i) != Some(b'\n') {
                    i += 1;
                }
            }
            (Some(b'/'), Some(b'*')) => {
                i += 2;
                i += C::comment_close(&sql[i..])? + 2;
            }
            _ => break,
        }
    }
    let mut word = [0u8; 10];
    let mut n = 0;
    while n < word.len()
        && let Some(c) = at(i + n)
        && c.is_ascii_alphabetic()
    {
        word[n] = c;
        n += 1;
    }
    if n < 2 {
        return None;
    }
    if let Some(next) = at(i + n)
        && !matches!(next, b' ' | b'\t' | b'\n' | b'\r' | b';' | b'(')
    {
        return None;
    }
    SQL_VERBS.get_ascii_case_insensitive(&word[..n]).copied()
}

/// Drop a query span without recording it (the query never got a reply).
pub fn discard(global: *mut c_void, span: NativeSpan) {
    rt::discard_pooled(global, span)
}

/// `db.query.text` cap; collectors reject multi-MB attributes.
const QUERY_TEXT_MAX: usize = 16 * 1024;

/// [`end`] for a statement held as a JS string. The verb is read off the
/// string's own storage; only the `db.query.text` prefix is transcoded, and
/// only when statements are captured.
pub fn end_string(
    global: *mut c_void,
    span: NativeSpan,
    statement: &bun_core::String,
    error: Option<DbError<'_>>,
) {
    if !span.is_some() {
        return;
    }
    let op = if statement.is_utf16() {
        sql_operation(statement.utf16())
    } else {
        sql_operation(statement.byte_slice())
    };
    // A code unit is at least one UTF-8 byte, so one unit past the cap keeps
    // a longer statement longer than QUERY_TEXT_MAX bytes and `truncate_utf8`
    // still trims it (split trailing sequence included).
    let text = crate::capture_db_statement().then(|| statement.trunc(QUERY_TEXT_MAX + 1).to_utf8());
    finish(
        global,
        span,
        op,
        text.as_ref().map_or(&b""[..], |t| t.slice()),
        error,
    );
}

/// Finish a query span. `statement` is UTF-8 and is recorded as
/// `db.query.text` when statement capture is on.
pub fn end(global: *mut c_void, span: NativeSpan, statement: &[u8], error: Option<DbError<'_>>) {
    if !span.is_some() {
        return;
    }
    let text: &[u8] = if crate::capture_db_statement() {
        statement
    } else {
        b""
    };
    finish(global, span, sql_operation(statement), text, error);
}

fn finish(
    global: *mut c_void,
    span: NativeSpan,
    op: Option<&'static str>,
    query_text: &[u8],
    error: Option<DbError<'_>>,
) {
    let op = op.map(str::as_bytes);
    if let Some(o) = op {
        rt::with_local(global, |local| {
            pool::with(&mut local.pool, span, |s| {
                // `{operation} {target}` when there is a namespace, else the operation.
                if s.has_attribute(b"db.namespace") {
                    // prefix in place: the slot's name buffer is reused across spans
                    s.name
                        .splice(0..0, o.iter().copied().chain(core::iter::once(b' ')));
                } else {
                    s.name.clear();
                    s.name.extend_from_slice(o);
                }
            });
        });
    }
    rt::end_pooled(global, span, 0, &mut |w| {
        if let Some(o) = op {
            w.attr("db.operation.name", o);
        }
        if !query_text.is_empty() {
            w.attr(
                "db.query.text",
                crate::otlp::truncate_utf8(query_text, QUERY_TEXT_MAX),
            );
        }
        if let Some(DbError {
            ty,
            message,
            from_server,
        }) = error
        {
            if from_server {
                w.attr_opt("db.response.status_code", ty);
            }
            w.fail(if ty.is_empty() { b"_OTHER" } else { ty }, message);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::sql_operation;

    #[test]
    fn leading_verb() {
        let cases: &[(&str, Option<&str>)] = &[
            ("", None),
            ("   ", None),
            ("SELECT 1", Some("SELECT")),
            ("select * from t", Some("SELECT")),
            ("  \n\tinsert into t values (1)", Some("INSERT")),
            ("(select 1) union (select 2)", Some("SELECT")),
            ("((with x as (select 1) select * from x", Some("WITH")),
            ("-- comment\nUPDATE t SET a=1", Some("UPDATE")),
            ("# mysql comment\n  DELETE FROM t", Some("DELETE")),
            ("/*/ hint */ SELECT 1", Some("SELECT")),
            ("/**/UPDATE t SET a=1", Some("UPDATE")),
            ("-- comment without newline", None),
            ("/* hi */ delete from t", Some("DELETE")),
            ("/* unterminated select 1", None),
            ("/* a */ -- b\n /* c */ SELECT 1", Some("SELECT")),
            ("SELECT;", Some("SELECT")),
            ("SELECT(1)", Some("SELECT")),
            ("SELECTX 1", None),
            ("SELECT1", None),
            ("S 1", None),
            ("do", Some("DO")),
            ("VERYLONGWORDHERE 1", None),
            ("1 SELECT", None),
            ("$1", None),
        ];
        for (sql, want) in cases {
            assert_eq!(sql_operation(sql.as_bytes()), *want, "{sql:?}");
            let wide: Vec<u16> = sql.encode_utf16().collect();
            assert_eq!(sql_operation(&wide), *want, "utf16 {sql:?}");
        }
    }

    #[test]
    fn long_leading_comment() {
        let comment = format!("/* {} */\n", "x".repeat(20 * 1024));
        let sql = format!("{comment}CREATE TABLE t (a int)");
        assert_eq!(sql_operation(sql.as_bytes()), Some("CREATE"));
        let wide: Vec<u16> = sql.encode_utf16().collect();
        assert_eq!(sql_operation(&wide), Some("CREATE"));
        // an identifier that only starts like a verb is not one, however far in
        let sql = format!("{comment}DO_maintenance(1)");
        assert_eq!(sql_operation(sql.as_bytes()), None);
    }

    #[test]
    fn non_ascii_units_are_not_verbs() {
        // U+0153 (œ) has low byte 0x53 'S': must not read as ASCII
        let wide: Vec<u16> = "\u{153}ELECT 1".encode_utf16().collect();
        assert_eq!(sql_operation(&wide), None);
        assert_eq!(sql_operation("\u{a0}SELECT 1".as_bytes()), None);
        let wide: Vec<u16> = "/* \u{1F600} */ select 1".encode_utf16().collect();
        assert_eq!(sql_operation(&wide), Some("SELECT"));
    }
}
