use crate::jsc::{JSGlobalObject, JSValue};
use bun_core::String;
use bun_core::StringBuilder;
use bun_sql::postgres::protocol::error_response::ErrorResponse;
use bun_sql::postgres::protocol::field_message::FieldMessage;

use crate::postgres::error_jsc::create_postgres_error;
use bun_sql::postgres::any_postgres_error::PostgresErrorOptions;

use super::notice_response_jsc::field_message_payload;

pub fn to_js(this: &ErrorResponse, global_object: &JSGlobalObject) -> JSValue {
    let mut b = StringBuilder::default();

    for msg in this.messages.iter() {
        // Zig: `switch (msg.*) { inline else => |m| m.utf8ByteLength() }` — every
        // FieldMessage variant carries a single bun.String payload.
        b.cap += field_message_payload(msg).utf8_byte_length() + 1;
    }
    let _ = b.allocate();

    let mut severity: &String = &String::DEAD;
    let mut code: &String = &String::DEAD;
    let mut message: &String = &String::DEAD;
    let mut detail: &String = &String::DEAD;
    let mut hint: &String = &String::DEAD;
    let mut position: &String = &String::DEAD;
    let mut internal_position: &String = &String::DEAD;
    let mut internal: &String = &String::DEAD;
    let mut where_: &String = &String::DEAD;
    let mut schema: &String = &String::DEAD;
    let mut table: &String = &String::DEAD;
    let mut column: &String = &String::DEAD;
    let mut datatype: &String = &String::DEAD;
    let mut constraint: &String = &String::DEAD;
    let mut file: &String = &String::DEAD;
    let mut line: &String = &String::DEAD;
    let mut routine: &String = &String::DEAD;

    for msg in this.messages.iter() {
        match msg {
            FieldMessage::Severity(str) => severity = str,
            FieldMessage::Code(str) => code = str,
            FieldMessage::Message(str) => message = str,
            FieldMessage::Detail(str) => detail = str,
            FieldMessage::Hint(str) => hint = str,
            FieldMessage::Position(str) => position = str,
            FieldMessage::InternalPosition(str) => internal_position = str,
            FieldMessage::Internal(str) => internal = str,
            FieldMessage::Where(str) => where_ = str,
            FieldMessage::Schema(str) => schema = str,
            FieldMessage::Table(str) => table = str,
            FieldMessage::Column(str) => column = str,
            FieldMessage::Datatype(str) => datatype = str,
            FieldMessage::Constraint(str) => constraint = str,
            FieldMessage::File(str) => file = str,
            FieldMessage::Line(str) => line = str,
            FieldMessage::Routine(str) => routine = str,
            _ => {}
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

    fn maybe_slice(s: &String) -> Option<&[u8]> {
        if s.is_empty() {
            None
        } else {
            Some(s.byte_slice())
        }
    }

    let errno = maybe_slice(code);
    // syntax error - https://www.postgresql.org/docs/8.1/errcodes-appendix.html
    let error_code: &'static [u8] = if code.eql_utf8(b"42601") {
        b"ERR_POSTGRES_SYNTAX_ERROR"
    } else {
        b"ERR_POSTGRES_SERVER_ERROR"
    };

    let detail_slice = maybe_slice(detail);
    let hint_slice = maybe_slice(hint);
    let severity_slice = maybe_slice(severity);
    let position_slice = maybe_slice(position);
    let internal_position_slice = maybe_slice(internal_position);
    let internal_query_slice = maybe_slice(internal);
    let where_slice = maybe_slice(where_);
    let schema_slice = maybe_slice(schema);
    let table_slice = maybe_slice(table);
    let column_slice = maybe_slice(column);
    let data_type_slice = maybe_slice(datatype);
    let constraint_slice = maybe_slice(constraint);
    let file_slice = maybe_slice(file);
    let line_slice = maybe_slice(line);
    let routine_slice = maybe_slice(routine);

    // PORT NOTE: reshaped for borrowck — `b.allocated_slice()` borrows `b`
    // mutably; capture `b.len` first.
    let len = b.len;
    let error_message: &[u8] = if len > 0 {
        &b.allocated_slice()[..len]
    } else {
        b""
    };

    create_postgres_error(
        global_object,
        error_message,
        PostgresErrorOptions {
            code: error_code,
            errno,
            detail: detail_slice,
            hint: hint_slice,
            severity: severity_slice,
            position: position_slice,
            internal_position: internal_position_slice,
            internal_query: internal_query_slice,
            r#where: where_slice,
            schema: schema_slice,
            table: table_slice,
            column: column_slice,
            data_type: data_type_slice,
            constraint: constraint_slice,
            file: file_slice,
            line: line_slice,
            routine: routine_slice,
        },
    )
    .unwrap_or_else(|e| global_object.take_error(e))
}

// ported from: src/sql_jsc/postgres/protocol/error_response_jsc.zig
