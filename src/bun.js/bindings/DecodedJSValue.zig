/// ABI-compatible with `JSC::JSValue`.
pub const DecodedJSValue = extern struct {
    const Self = @This();

    u: EncodedValueDescriptor,

    /// ABI-compatible with `JSC::EncodedValueDescriptor`.
    pub const EncodedValueDescriptor = extern union {
        asInt64: i64,
        ptr: ?*jsc.JSCell,
        asBits: extern struct {
            payload: i32,
            tag: i32,
        },
    };

    /// Equivalent to `JSC::JSValue::encode`.
    pub fn encode(self: Self) jsc.JSValue {
        return @enumFromInt(self.u.asInt64);
    }
};

comptime {
    bun.assertf(@sizeOf(usize) == 8, "EncodedValueDescriptor assumes a 64-bit system", .{});
    bun.assertf(
        @import("builtin").target.cpu.arch.endian() == .little,
        "EncodedValueDescriptor.asBits assumes a little-endian system",
        .{},
    );
}

const bun = @import("bun");
const jsc = bun.bun_js.jsc;
