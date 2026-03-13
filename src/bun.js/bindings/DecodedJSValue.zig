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

    fn asU64(self: Self) u64 {
        return @bitCast(self.u.asInt64);
    }

    /// Equivalent to `JSC::JSValue::isCell`. Note that like JSC, this method treats 0 as a cell.
    pub fn isCell(self: Self) bool {
        return self.asU64() & ffi.NotCellMask == 0;
    }

    /// Equivalent to `JSC::JSValue::asCell`.
    pub fn asCell(self: Self) ?*jsc.JSCell {
        bun.assertf(self.isCell(), "not a cell: 0x{x}", .{self.asU64()});
        return self.u.ptr;
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
const ffi = @import("./FFI.zig");
const jsc = bun.bun_js.jsc;
