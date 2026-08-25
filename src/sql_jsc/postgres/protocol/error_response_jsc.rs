use crate::jsc::{JSGlobalObject, JSValue};
use bun_core::StringBuilder;
use bun_core::StringView;
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

    let mut severity = StringView::DEAD;
    let mut code = StringView::DEAD;
    let mut message = StringView::DEAD;
    let mut detail = StringView::DEAD;
    let mut hint = StringView::DEAD;
    let mut position = StringView::DEAD;
    let mut internal_position = StringView::DEAD;
    let mut internal = StringView::DEAD;
    let mut where_ = StringView::DEAD;
    let mut schema = StringView::DEAD;
    let mut table = StringView::DEAD;
    let mut column = StringView::DEAD;
    let mut datatype = StringView::DEAD;
    let mut constraint = StringView::DEAD;
    let mut file = StringView::DEAD;
    let mut line = StringView::DEAD;
    let mut routine = StringView::DEAD;

    for msg in this.messages.iter() {
        match msg {
            FieldMessage::Severity(str) => severity = str.as_view(),
            FieldMessage::Code(str) => code = str.as_view(),
            FieldMessage::Message(str) => message = str.as_view(),
            FieldMessage::Detail(str) => detail = str.as_view(),
            FieldMessage::Hint(str) => hint = str.as_view(),
            FieldMessage::Position(str) => position = str.as_view(),
            FieldMessage::InternalPosition(str) => internal_position = str.as_view(),
            FieldMessage::Internal(str) => internal = str.as_view(),
            FieldMessage::Where(str) => where_ = str.as_view(),
            FieldMessage::Schema(str) => schema = str.as_view(),
            FieldMessage::Table(str) => table = str.as_view(),
            FieldMessage::Column(str) => column = str.as_view(),
            FieldMessage::Datatype(str) => datatype = str.as_view(),
            FieldMessage::Constraint(str) => constraint = str.as_view(),
            FieldMessage::File(str) => file = str.as_view(),
            FieldMessage::Line(str) => line = str.as_view(),
            FieldMessage::Routine(str) => routine = str.as_view(),
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

    fn maybe_slice<'a>(s: StringView<'a>) -> Option<&'a [u8]> {
        if s.is_empty() {
            None
        } else {
            Some(s.byte_slice())
        }
    }

    let errno = maybe_slice(code);
    // syntax error - https://www.postgresql.org/docs/8.1/errcodes-appendix.html
    let error_code: &'static [u8] = if code.eq_ascii(b"42601") {
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

    // Capture `b.len` first: `b.allocated_slice()` borrows `b` mutably.
    let len = b.len;
    let error_message: &[u8] = if len > 0 {
        &b.allocated_slice()[..len]
    } else {
        b""
    };

    create_postgres_error(
        global_object,
        error_message,
        &PostgresErrorOptions {
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
