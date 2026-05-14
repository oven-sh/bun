use crate::jsc::{JSGlobalObject, JSValue};
use bun_core::StringBuilder;
use bun_jsc::UnsafeStringViewJsc as _;
use bun_jsc::unsafe_string_view::UnsafeStringView;
use bun_sql::postgres::protocol::field_message::FieldMessage;
use bun_sql::postgres::protocol::notice_response::NoticeResponse;

/// Every `FieldMessage` variant carries a single `bun.String` payload.
/// `bun_sql::FieldMessage` doesn't (yet) expose a `payload()` accessor, so
/// match locally.
// TODO(b2-blocked): bun_sql::postgres::protocol::field_message::FieldMessage::payload
// — once landed, replace this whole match with `msg.payload()`.
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

pub fn to_js(this: &NoticeResponse, global_object: &JSGlobalObject) -> JSValue {
    let mut b = StringBuilder::default();
    // `defer b.deinit(bun.default_allocator)` — handled by Drop.

    for msg in this.messages.as_slice() {
        // PORT NOTE: payload types share the called method, so dispatch via
        // the local helper instead of matching every variant inline.
        b.cap += field_message_payload(msg).utf8_byte_length() + 1;
    }
    let _ = b.allocate(); // swallow alloc error (best-effort allocation).

    for msg in this.messages.as_slice() {
        let str = field_message_payload(msg).to_utf8();
        // Cleanup is handled by Drop on UTF8Slice.
        let _ = b.append(str.slice());
        let _ = b.append(b"\n");
    }

    let len = b.len;
    UnsafeStringView::init(&b.allocated_slice()[0..len]).to_js(global_object)
}
