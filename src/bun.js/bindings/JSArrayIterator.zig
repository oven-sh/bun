const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSObject = @import("./JSObject.zig").JSObject;

pub const JSArrayIterator = struct {
    i: u32 = 0,
    len: u32 = 0,
    array: JSValue,
    global: *JSGlobalObject,

    pub fn init(value: JSValue, global: *JSGlobalObject) JSArrayIterator {
        return .{
            .array = value,
            .global = global,
            .len = @as(u32, @truncate(value.getLength(global))),
        };
    }

    // TODO: this can throw
    pub fn next(this: *JSArrayIterator) ?JSValue {
        if (!(this.i < this.len)) {
            return null;
        }
        const i = this.i;
        this.i += 1;
        return JSObject.getIndex(this.array, this.global, i);
    }
};
