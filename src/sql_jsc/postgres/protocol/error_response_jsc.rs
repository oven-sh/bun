use crate::jsc::{JSGlobalObject, JSValue};
use bun_core::String;
use bun_core::StringBuilder;
use bun_core::Utf8Bytes;
use bun_sql::postgres::protocol::error_response::ErrorResponse;
use bun_sql::postgres::protocol::field_message::FieldMessage;

use crate::postgres::error_jsc::create_postgres_error;
use bun_sql::postgres::any_postgres_error::PostgresErrorOptions;

pub(crate) fn to_js(this: &ErrorResponse, global_object: &JSGlobalObject) -> JSValue {
    let mut b = StringBuilder::default();

    for msg in this.messages.iter() {
        b.cap += msg.payload().utf8_byte_length() + 1;
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

    fn utf8(s: &String) -> Option<Utf8Bytes<'_>> {
        (!s.is_empty()).then(|| s.to_utf8())
    }

    // syntax error - https://www.postgresql.org/docs/8.1/errcodes-appendix.html
    let error_code: &'static [u8] = if code.eq_ascii(b"42601") {
        b"ERR_POSTGRES_SYNTAX_ERROR"
    } else {
        b"ERR_POSTGRES_SERVER_ERROR"
    };

    create_postgres_error(
        global_object,
        b.written_slice(),
        &PostgresErrorOptions {
            code: error_code,
            errno: utf8(code).as_deref(),
            detail: utf8(detail).as_deref(),
            hint: utf8(hint).as_deref(),
            severity: utf8(severity).as_deref(),
            position: utf8(position).as_deref(),
            internal_position: utf8(internal_position).as_deref(),
            internal_query: utf8(internal).as_deref(),
            r#where: utf8(where_).as_deref(),
            schema: utf8(schema).as_deref(),
            table: utf8(table).as_deref(),
            column: utf8(column).as_deref(),
            data_type: utf8(datatype).as_deref(),
            constraint: utf8(constraint).as_deref(),
            file: utf8(file).as_deref(),
            line: utf8(line).as_deref(),
            routine: utf8(routine).as_deref(),
        },
    )
    .unwrap_or_else(|e| global_object.take_error(e))
}
