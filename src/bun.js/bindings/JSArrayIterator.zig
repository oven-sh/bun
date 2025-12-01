pub const JSArrayIterator = struct {
    i: u32 = 0,
    len: u32 = 0,
    array: JSValue,
    global: *JSGlobalObject,

    pub fn init(value: JSValue, global: *JSGlobalObject) bun.JSError!JSArrayIterator {
        return .{
            .array = value,
            .global = global,
            .len = @truncate(try value.getLength(global)),
        };
    }

    pub fn next(this: *JSArrayIterator) bun.JSError!?JSValue {
        if (!(this.i < this.len)) {
            return null;
        }
        const i = this.i;
        this.i += 1;
        return try JSObject.getIndex(this.array, this.global, i);
    }
};

const bun = @import("bun");
const JSObject = @import("./JSObject.zig").JSObject;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
