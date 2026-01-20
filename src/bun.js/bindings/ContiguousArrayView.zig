pub const ContiguousArrayView = struct {
    elements: [*]const JSValue,
    len: u32,
    i: u32 = 0,

    pub fn init(value: JSValue, global: *JSGlobalObject) ?ContiguousArrayView {
        var length: u32 = 0;
        const ptr = Bun__JSArray__getContiguousVector(value, global, &length);
        if (ptr == null) return null;
        return .{ .elements = @ptrCast(ptr.?), .len = length };
    }

    pub inline fn next(self: *ContiguousArrayView) ?JSValue {
        if (self.i >= self.len) return null;
        const val = self.elements[self.i];
        self.i += 1;
        if (val == .zero) return .js_undefined; // hole
        return val;
    }

    extern fn Bun__JSArray__getContiguousVector(JSValue, *JSGlobalObject, *u32) ?[*]const JSValue;
};

const bun = @import("bun");
const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
