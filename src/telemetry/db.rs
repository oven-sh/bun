//! Database client spans (PostgreSQL, MySQL, SQLite, Redis).
//! https://opentelemetry.io/docs/specs/semconv/database/database-spans/

use crate::{Instrument, Record};

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

/// semconv names the span `{operation} {target}`. The operation is added by [`describe_statement`].
pub fn describe_system(record: &mut Record, system: System) {
    let name = system.name().as_bytes();
    record.set_name(name);
    record.attr("db.system.name", name);
}

pub fn describe_connection(record: &mut Record, conn: &ConnectionInfo<'_>) {
    if !conn.namespace.is_empty() {
        record.set_name(conn.namespace);
        record.attr("db.namespace", conn.namespace);
    }
    record.server(conn.host, conn.port);
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

/// Collectors reject attributes of several megabytes.
pub const QUERY_TEXT_MAX: usize = 16 * 1024;

/// `text` is left out unless statements are captured.
pub fn describe_statement(record: &mut Record, operation: Option<&[u8]>, text: &[u8]) {
    if let Some(operation) = operation {
        if record.has_attribute(b"db.namespace") {
            record.prefix_name(operation);
        } else {
            record.set_name(operation);
        }
        record.attr("db.operation.name", operation);
    }
    if crate::capture_db_statement() {
        let text = crate::otlp::truncate_utf8(text, QUERY_TEXT_MAX);
        record.attr_opt("db.query.text", text);
    }
}

fn has_secret_arguments(redis_command: &[u8]) -> bool {
    matches!(
        redis_command,
        b"AUTH" | b"HELLO" | b"MIGRATE" | b"ACL" | b"CONFIG"
    )
}

/// The text has the first argument, which is the key of most commands, and never a value.
pub fn describe_redis_command(record: &mut Record, name: &[u8], first: &[u8], has_more: bool) {
    let name = crate::otlp::truncate_utf8(name, 24).to_ascii_uppercase();
    let mut text = Vec::new();
    if !has_secret_arguments(&name) {
        text.extend_from_slice(&name);
        if matches!(&*name, b"ECHO" | b"PING") {
            return describe_statement(record, Some(&name), &text);
        }
        if !first.is_empty() {
            text.push(b' ');
            text.extend_from_slice(crate::otlp::truncate_utf8(first, 256));
        }
        if has_more {
            text.extend_from_slice(b" ...");
        }
    }
    describe_statement(record, Some(&name), &text);
}

impl<'a> DbError<'a> {
    /// A reply quotes arguments: all of them for an unknown command, a password for `ACL`.
    pub fn of_redis(reply: &'a [u8], record: &Record) -> DbError<'a> {
        use bun_core::strings;
        let command = strings::split(record.name(), b" ")
            .next()
            .unwrap_or_default();
        let end = match has_secret_arguments(command) {
            true => 0,
            false => strings::index_of(reply, b", with args beginning with").unwrap_or(reply.len()),
        };
        DbError {
            ty: strings::split(reply, b" ").next().unwrap_or_default(),
            message: &reply[..end],
            from_server: true,
        }
    }

    pub fn record(&self, record: &mut Record) {
        if self.from_server {
            record.attr_opt("db.response.status_code", self.ty);
        }
        record.fail_with_code(self.ty, self.message);
    }
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
