use bun_core::StringBuilder;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_sql::postgres::protocol::NoticeResponse;
use bun_str::ZigString;

pub fn to_js(this: &NoticeResponse, global_object: &JSGlobalObject) -> JSValue {
    let mut b = StringBuilder::default();
    // `defer b.deinit(bun.default_allocator)` — handled by Drop.

    for msg in this.messages.as_slice() {
        // PORT NOTE: Zig `switch (msg) { inline else => |m| m.utf8ByteLength() }` —
        // payload types share the called method, so dispatch via a trait/method on `msg`.
        b.cap += msg.utf8_byte_length() + 1;
    }
    let _ = b.allocate(); // `catch {}` — swallow alloc error to match Zig.

    for msg in this.messages.as_slice() {
        // PORT NOTE: Zig `switch (msg) { inline else => |m| m.toUTF8(bun.default_allocator) }`.
        let str = msg.to_utf8();
        // `defer str.deinit()` — handled by Drop on Utf8Slice.
        let _ = b.append(str.slice());
        let _ = b.append(b"\n");
    }

    ZigString::init(&b.allocated_slice()[0..b.len]).to_js(global_object)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/protocol/notice_response_jsc.zig (28 lines)
//   confidence: medium
//   todos:      0
//   notes:      `inline else` switches collapsed to direct method calls (variants share utf8_byte_length/to_utf8); Phase B may wrap as NoticeResponseJsc ext trait.
// ──────────────────────────────────────────────────────────────────────────
