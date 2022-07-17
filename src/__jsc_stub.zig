// For WASM builds
pub const is_bindgen = true;
pub const C = struct {};
pub const WebCore = struct {};
pub const Jest = struct {};
pub const API = struct {
    pub const Transpiler = struct {};
};
pub const Node = struct {};

pub const VirtualMachine = struct {};

pub const JSGlobalObject = struct {};

pub const JSValue = struct {};

pub const WTF = struct {
    pub fn copyLCharsFromUCharSource(_: [*]u8, comptime Source: type, _: Source) void {}
    pub fn toBase64URLStringValue(_: []const u8, _: *JSGlobalObject) JSValue {
        return JSValue{};
    }
};
