use bun_jsc::{JSGlobalObject, JSValue};
use bun_sql::postgres::protocol::error_response::{ErrorResponse, FieldMessage};
use bun_str::String;
use bun_str::StringBuilder;

use crate::postgres::error_jsc::{create_postgres_error, PostgresErrorFields};

pub fn to_js(this: &ErrorResponse, global_object: &JSGlobalObject) -> JSValue {
    let mut b = StringBuilder::default();

    for msg in this.messages.iter() {
        // TODO(port): `switch (msg.*) { inline else => |m| m.utf8ByteLength() }` — assumes
        // FieldMessage exposes the inner bun_str::String via `as_str()` (all payloads are String).
        b.cap += msg.as_str().utf8_byte_length() + 1;
    }
    let _ = b.allocate();

    let mut severity: String = String::DEAD;
    let mut code: String = String::DEAD;
    let mut message: String = String::DEAD;
    let mut detail: String = String::DEAD;
    let mut hint: String = String::DEAD;
    let mut position: String = String::DEAD;
    let mut internal_position: String = String::DEAD;
    let mut internal: String = String::DEAD;
    let mut where_: String = String::DEAD;
    let mut schema: String = String::DEAD;
    let mut table: String = String::DEAD;
    let mut column: String = String::DEAD;
    let mut datatype: String = String::DEAD;
    let mut constraint: String = String::DEAD;
    let mut file: String = String::DEAD;
    let mut line: String = String::DEAD;
    let mut routine: String = String::DEAD;

    for msg in this.messages.iter() {
        match msg {
            FieldMessage::Severity(str) => severity = *str,
            FieldMessage::Code(str) => code = *str,
            FieldMessage::Message(str) => message = *str,
            FieldMessage::Detail(str) => detail = *str,
            FieldMessage::Hint(str) => hint = *str,
            FieldMessage::Position(str) => position = *str,
            FieldMessage::InternalPosition(str) => internal_position = *str,
            FieldMessage::Internal(str) => internal = *str,
            FieldMessage::Where(str) => where_ = *str,
            FieldMessage::Schema(str) => schema = *str,
            FieldMessage::Table(str) => table = *str,
            FieldMessage::Column(str) => column = *str,
            FieldMessage::Datatype(str) => datatype = *str,
            FieldMessage::Constraint(str) => constraint = *str,
            FieldMessage::File(str) => file = *str,
            FieldMessage::Line(str) => line = *str,
            FieldMessage::Routine(str) => routine = *str,
            _ => {}
        }
    }

    let mut needs_newline = false;
    'construct_message: {
        if !message.is_empty() {
            let _ = b.append_str(&message);
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
            let _ = b.append_str(&detail);
        }
        if !hint.is_empty() {
            if needs_newline {
                let _ = b.append(b"\n");
            } else {
                let _ = b.append(b" ");
            }
            needs_newline = true;
            let _ = b.append_str(&hint);
        }
    }
    let _ = needs_newline;

    let errno: Option<&[u8]> = if !code.is_empty() { Some(code.byte_slice()) } else { None };
    // syntax error - https://www.postgresql.org/docs/8.1/errcodes-appendix.html
    let error_code: &'static [u8] = if code.eql(b"42601") {
        b"ERR_POSTGRES_SYNTAX_ERROR"
    } else {
        b"ERR_POSTGRES_SERVER_ERROR"
    };

    let detail_slice: Option<&[u8]> = if detail.is_empty() { None } else { Some(detail.byte_slice()) };
    let hint_slice: Option<&[u8]> = if hint.is_empty() { None } else { Some(hint.byte_slice()) };
    let severity_slice: Option<&[u8]> = if severity.is_empty() { None } else { Some(severity.byte_slice()) };
    let position_slice: Option<&[u8]> = if position.is_empty() { None } else { Some(position.byte_slice()) };
    let internal_position_slice: Option<&[u8]> = if internal_position.is_empty() { None } else { Some(internal_position.byte_slice()) };
    let internal_query_slice: Option<&[u8]> = if internal.is_empty() { None } else { Some(internal.byte_slice()) };
    let where_slice: Option<&[u8]> = if where_.is_empty() { None } else { Some(where_.byte_slice()) };
    let schema_slice: Option<&[u8]> = if schema.is_empty() { None } else { Some(schema.byte_slice()) };
    let table_slice: Option<&[u8]> = if table.is_empty() { None } else { Some(table.byte_slice()) };
    let column_slice: Option<&[u8]> = if column.is_empty() { None } else { Some(column.byte_slice()) };
    let data_type_slice: Option<&[u8]> = if datatype.is_empty() { None } else { Some(datatype.byte_slice()) };
    let constraint_slice: Option<&[u8]> = if constraint.is_empty() { None } else { Some(constraint.byte_slice()) };
    let file_slice: Option<&[u8]> = if file.is_empty() { None } else { Some(file.byte_slice()) };
    let line_slice: Option<&[u8]> = if line.is_empty() { None } else { Some(line.byte_slice()) };
    let routine_slice: Option<&[u8]> = if routine.is_empty() { None } else { Some(routine.byte_slice()) };

    let error_message: &[u8] = if b.len > 0 { &b.allocated_slice()[..b.len] } else { b"" };

    create_postgres_error(
        global_object,
        error_message,
        // TODO(port): exact options-struct type name from error_jsc.rs
        PostgresErrorFields {
            code: error_code,
            errno,
            detail: detail_slice,
            hint: hint_slice,
            severity: severity_slice,
            position: position_slice,
            internal_position: internal_position_slice,
            internal_query: internal_query_slice,
            where_: where_slice,
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/protocol/error_response_jsc.zig (132 lines)
//   confidence: medium
//   todos:      2
//   notes:      FieldMessage enum name + as_str() helper assumed; PostgresErrorFields struct name guessed from error_jsc; bun_str::String assumed Copy for match arms
// ──────────────────────────────────────────────────────────────────────────
