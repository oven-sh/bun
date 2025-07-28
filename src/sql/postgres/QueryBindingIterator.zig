pub const QueryBindingIterator = union(enum) {
    array: jsc.JSArrayIterator,
    objects: ObjectIterator,

    pub fn init(array: JSValue, columns: JSValue, globalObject: *jsc.JSGlobalObject) bun.JSError!QueryBindingIterator {
        if (columns.isEmptyOrUndefinedOrNull()) {
            return .{ .array = try jsc.JSArrayIterator.init(array, globalObject) };
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

    pub fn next(this: *QueryBindingIterator) bun.JSError!?jsc.JSValue {
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

const ObjectIterator = @import("./ObjectIterator.zig");
const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
