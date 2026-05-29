use bun_sql::postgres::protocol::field_message::FieldMessage;

pub(crate) fn field_message_payload(msg: &FieldMessage) -> &bun_core::String {
    match msg {
        FieldMessage::Severity(s)
        | FieldMessage::LocalizedSeverity(s)
        | FieldMessage::Code(s)
        | FieldMessage::Message(s)
        | FieldMessage::Detail(s)
        | FieldMessage::Hint(s)
        | FieldMessage::Position(s)
        | FieldMessage::InternalPosition(s)
        | FieldMessage::Internal(s)
        | FieldMessage::Where(s)
        | FieldMessage::Schema(s)
        | FieldMessage::Table(s)
        | FieldMessage::Column(s)
        | FieldMessage::Datatype(s)
        | FieldMessage::Constraint(s)
        | FieldMessage::File(s)
        | FieldMessage::Line(s)
        | FieldMessage::Routine(s) => s,
    }
}

// ported from: src/sql_jsc/postgres/protocol/notice_response_jsc.zig
