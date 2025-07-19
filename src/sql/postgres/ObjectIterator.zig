array: JSValue,
columns: JSValue = .zero,
globalObject: *JSC.JSGlobalObject,
cell_i: usize = 0,
row_i: usize = 0,
current_row: JSC.JSValue = .zero,
columns_count: usize = 0,
array_length: usize = 0,
any_failed: bool = false,

pub fn next(this: *ObjectIterator) ?JSC.JSValue {
    if (this.row_i >= this.array_length) {
        return null;
    }

    const cell_i = this.cell_i;
    this.cell_i += 1;
    const row_i = this.row_i;

    const globalObject = this.globalObject;

    if (this.current_row == .zero) {
        this.current_row = JSC.JSObject.getIndex(this.array, globalObject, @intCast(row_i)) catch {
            this.any_failed = true;
            return null;
        };
        if (this.current_row.isEmptyOrUndefinedOrNull()) {
            return globalObject.throw("Expected a row to be returned at index {d}", .{row_i}) catch null;
        }
    }

    defer {
        if (this.cell_i >= this.columns_count) {
            this.cell_i = 0;
            this.current_row = .zero;
            this.row_i += 1;
        }
    }

    const property = JSC.JSObject.getIndex(this.columns, globalObject, @intCast(cell_i)) catch {
        this.any_failed = true;
        return null;
    };
    if (property.isUndefined()) {
        return globalObject.throw("Expected a column at index {d} in row {d}", .{ cell_i, row_i }) catch null;
    }

    const value = this.current_row.getOwnByValue(globalObject, property);
    if (value == .zero or (value != null and value.?.isUndefined())) {
        if (!globalObject.hasException())
            return globalObject.throw("Expected a value at index {d} in row {d}", .{ cell_i, row_i }) catch null;
        this.any_failed = true;
        return null;
    }
    return value;
}

// @sortImports

const ObjectIterator = @This();
const bun = @import("bun");

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
