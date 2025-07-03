pub const QueryBindingIterator = union(enum) {
    array: JSC.JSArrayIterator,
    objects: ObjectIterator,

    pub fn init(array: JSValue, columns: JSValue, globalObject: *JSC.JSGlobalObject) bun.JSError!QueryBindingIterator {
        if (columns.isEmptyOrUndefinedOrNull()) {
            return .{ .array = try JSC.JSArrayIterator.init(array, globalObject) };
        }

        return .{
            .objects = .{
                .array = array,
                .columns = columns,
                .globalObject = globalObject,
                .columns_count = try columns.getLength(globalObject),
                .array_length = try array.getLength(globalObject),
            },
        };
    }

    pub const ObjectIterator = struct {
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
    };

    pub fn next(this: *QueryBindingIterator) bun.JSError!?JSC.JSValue {
        return switch (this.*) {
            .array => |*iter| iter.next(),
            .objects => |*iter| iter.next(),
        };
    }

    pub fn anyFailed(this: *const QueryBindingIterator) bool {
        return switch (this.*) {
            .array => false,
            .objects => |*iter| iter.any_failed,
        };
    }

    pub fn to(this: *QueryBindingIterator, index: u32) void {
        switch (this.*) {
            .array => |*iter| iter.i = index,
            .objects => |*iter| {
                iter.cell_i = index % iter.columns_count;
                iter.row_i = index / iter.columns_count;
                iter.current_row = .zero;
            },
        }
    }

    pub fn reset(this: *QueryBindingIterator) void {
        switch (this.*) {
            .array => |*iter| {
                iter.i = 0;
            },
            .objects => |*iter| {
                iter.cell_i = 0;
                iter.row_i = 0;
                iter.current_row = .zero;
            },
        }
    }
};
const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
