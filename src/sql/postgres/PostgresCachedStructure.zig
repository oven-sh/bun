structure: JSC.Strong.Optional = .empty,
// only populated if more than JSC.JSC__JSObject__maxInlineCapacity fields otherwise the structure will contain all fields inlined
fields: ?[]JSC.JSObject.ExternColumnIdentifier = null,

pub fn has(this: *@This()) bool {
    return this.structure.has() or this.fields != null;
}

pub fn jsValue(this: *const @This()) ?JSC.JSValue {
    return this.structure.get();
}

pub fn set(this: *@This(), globalObject: *JSC.JSGlobalObject, value: ?JSC.JSValue, fields: ?[]JSC.JSObject.ExternColumnIdentifier) void {
    if (value) |v| {
        this.structure.set(globalObject, v);
    }
    this.fields = fields;
}

pub fn deinit(this: *@This()) void {
    this.structure.deinit();
    if (this.fields) |fields| {
        this.fields = null;
        for (fields) |*name| {
            name.deinit();
        }
        bun.default_allocator.free(fields);
    }
}

// @sortImports

const bun = @import("bun");
const JSC = bun.JSC;
