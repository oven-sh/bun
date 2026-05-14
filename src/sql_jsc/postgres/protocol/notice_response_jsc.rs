use crate::jsc::{JSGlobalObject, JSValue};
use bun_core::StringBuilder;
use bun_jsc::ZigStringJsc as _;
use bun_jsc::zig_string::ZigString;
use bun_sql::postgres::protocol::field_message::FieldMessage;
use bun_sql::postgres::protocol::notice_response::NoticeResponse;

/// Zig `switch (msg) { inline else => |m| ... }` — every `FieldMessage` variant
/// carries a single `bun.String` payload. `bun_sql::FieldMessage` doesn't (yet)
/// expose a `payload()` accessor, so match locally.
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
        // PORT NOTE: Zig `switch (msg) { inline else => |m| m.utf8ByteLength() }` —
        // payload types share the called method, so dispatch via the local helper.
        b.cap += field_message_payload(msg).utf8_byte_length() + 1;
    }
    let _ = b.allocate(); // `catch {}` — swallow alloc error to match Zig.

    for msg in this.messages.as_slice() {
        // PORT NOTE: Zig `switch (msg) { inline else => |m| m.toUTF8(bun.default_allocator) }`.
        let str = field_message_payload(msg).to_utf8();
        // `defer str.deinit()` — handled by Drop on ZigStringSlice.
        let _ = b.append(str.slice());
        let _ = b.append(b"\n");
    }

    let len = b.len;
    ZigString::init(&b.allocated_slice()[0..len]).to_js(global_object)
}

// ported from: src/sql_jsc/postgres/protocol/notice_response_jsc.zig
