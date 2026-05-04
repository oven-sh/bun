use bun_jsc::{JSGlobalObject, JSValue};
use bun_sql::postgres::types::int_types::short;
use bun_sql::postgres::AnyPostgresError;
use bun_sql::shared::Data;
use bun_str::StringJsc as _; // extension trait providing .to_js() on bun_str::String

pub const TO: i32 = 25;
pub const FROM: [short; 1] = [1002];

/// Zig's `toJSWithType` switches on `comptime Type: type`. Rust models this as a
/// trait with per-type impls; the `else => @compileError(...)` arm is the natural
/// "no impl" compile error.
pub trait ToJsWithType {
    fn to_js_with_type(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError>;
}

// Covers Zig arms `[:0]u8, []u8, []const u8, [:0]const u8` — all collapse to a byte slice.
impl ToJsWithType for &[u8] {
    fn to_js_with_type(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        let str = bun_str::String::borrow_utf8(self);
        // `defer str.deinit()` → Drop on bun_str::String
        Ok(str.to_js(global))
    }
}

impl ToJsWithType for bun_str::String {
    fn to_js_with_type(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        Ok(self.to_js(global))
    }
}

impl ToJsWithType for &mut Data {
    fn to_js_with_type(self, global: &JSGlobalObject) -> Result<JSValue, AnyPostgresError> {
        let str = bun_str::String::borrow_utf8(self.slice());
        // `defer str.deinit()` → Drop on bun_str::String
        // TODO(port): Zig calls `value.deinit()` here (consumes the Data). In Rust, Data's
        // Drop should handle this at the caller's scope; revisit ownership if Data must be
        // freed before this fn returns.
        Ok(str.to_js(global))
    }
}

pub fn to_js_with_type<T: ToJsWithType>(
    global: &JSGlobalObject,
    value: T,
) -> Result<JSValue, AnyPostgresError> {
    value.to_js_with_type(global)
}

pub fn to_js<T: ToJsWithType>(
    global: &JSGlobalObject,
    value: T,
) -> Result<JSValue, AnyPostgresError> {
    // TODO(port): the Zig body binds the JSValue result of `toJSWithType` to `str`, then
    // calls `str.deinit()` and `str.toJS(globalThis)` on it — JSValue has neither method,
    // so the original appears to be dead/unreachable code. Porting as a direct forward.
    // TODO(port): narrow error set
    value.to_js_with_type(global)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/types/PostgresString.zig (50 lines)
//   confidence: medium
//   todos:      3
//   notes:      comptime type-switch ported as trait; Zig `toJS` body looks broken upstream (calls .deinit/.toJS on JSValue) — ported as forward
// ──────────────────────────────────────────────────────────────────────────
