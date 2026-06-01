use crate::jsc::{JSGlobalObject, JSValue};
use bun_core::String;
use bun_core::StringBuilder;
use bun_sql::postgres::protocol::error_response::ErrorResponse;
use bun_sql::postgres::protocol::field_message::FieldMessage;

use crate::postgres::error_jsc::create_postgres_error;
use bun_sql::postgres::any_postgres_error::PostgresErrorOptions;

use super::notice_response_jsc::field_message_payload;

pub(crate) fn to_js(this: &ErrorResponse, global_object: &JSGlobalObject) -> JSValue {
    let mut b = StringBuilder::default();

    for msg in this.messages.iter() {
        // Zig: `switch (msg.*) { inline else => |m| m.utf8ByteLength() }` — every
        // FieldMessage variant carries a single bun.String payload.
        b.cap += field_message_payload(msg).utf8_byte_length() + 1;
    }
    let _ = b.allocate();

    fn maybe_slice(s: &String) -> Option<&[u8]> {
        if s.is_empty() {
            None
        } else {
            Some(s.byte_slice())
        }
    }

    let mut code: &String = &String::DEAD;
    let mut message: &String = &String::DEAD;
    let mut detail: &String = &String::DEAD;
    let mut hint: &String = &String::DEAD;
    let mut opts = PostgresErrorOptions::default();

    for msg in this.messages.iter() {
        match msg {
            FieldMessage::Severity(str) => opts.severity = maybe_slice(str),
            FieldMessage::Code(str) => code = str,
            FieldMessage::Message(str) => message = str,
            FieldMessage::Detail(str) => detail = str,
            FieldMessage::Hint(str) => hint = str,
            FieldMessage::Position(str) => opts.position = maybe_slice(str),
            FieldMessage::InternalPosition(str) => opts.internal_position = maybe_slice(str),
            FieldMessage::Internal(str) => opts.internal_query = maybe_slice(str),
            FieldMessage::Where(str) => opts.r#where = maybe_slice(str),
            FieldMessage::Schema(str) => opts.schema = maybe_slice(str),
            FieldMessage::Table(str) => opts.table = maybe_slice(str),
            FieldMessage::Column(str) => opts.column = maybe_slice(str),
            FieldMessage::Datatype(str) => opts.data_type = maybe_slice(str),
            FieldMessage::Constraint(str) => opts.constraint = maybe_slice(str),
            FieldMessage::File(str) => opts.file = maybe_slice(str),
            FieldMessage::Line(str) => opts.line = maybe_slice(str),
            FieldMessage::Routine(str) => opts.routine = maybe_slice(str),
            FieldMessage::LocalizedSeverity(_) => {}
        }
    }

    let mut needs_newline = false;
    'construct_message: {
        if !message.is_empty() {
            let utf8 = message.to_utf8();
            let _ = b.append(utf8.slice());
            needs_newline = true;
            break 'construct_message;
        }
        if !detail.is_empty() {
            if needs_newline {
                let _ = b.append(b"\n");
            } else {
                let _ = b.append(b" ");
            }
            needs_newline = true;
            let utf8 = detail.to_utf8();
            let _ = b.append(utf8.slice());
        }
        if !hint.is_empty() {
            if needs_newline {
                let _ = b.append(b"\n");
            } else {
                let _ = b.append(b" ");
            }
            needs_newline = true;
            let utf8 = hint.to_utf8();
            let _ = b.append(utf8.slice());
        }
    }
    let _ = needs_newline;

    opts.errno = maybe_slice(code);
    opts.detail = maybe_slice(detail);
    opts.hint = maybe_slice(hint);
    // syntax error - https://www.postgresql.org/docs/8.1/errcodes-appendix.html
    opts.code = if code.eql_utf8(b"42601") {
        b"ERR_POSTGRES_SYNTAX_ERROR"
    } else {
        b"ERR_POSTGRES_SERVER_ERROR"
    };

    // PORT NOTE: reshaped for borrowck — `b.allocated_slice()` borrows `b`
    // mutably; capture `b.len` first.
    let len = b.len;
    let error_message: &[u8] = if len > 0 {
        &b.allocated_slice()[..len]
    } else {
        b""
    };

    create_postgres_error(global_object, error_message, &opts)
        .unwrap_or_else(|e| global_object.take_error(e))
}

// ported from: src/sql_jsc/postgres/protocol/error_response_jsc.zig
