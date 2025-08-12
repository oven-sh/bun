const Signature = @This();
fields: []const FieldType = &.{},
name: []const u8 = "",
query: []const u8 = "",

pub fn deinit(this: *Signature) void {
    bun.default_allocator.free(this.fields);
    bun.default_allocator.free(this.name);
    bun.default_allocator.free(this.query);
}

pub fn hash(this: *const Signature) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(this.name);
    hasher.update(std.mem.sliceAsBytes(this.fields));
    return hasher.final();
}

pub fn generate(globalObject: *jsc.JSGlobalObject, query: []const u8, array_value: JSValue, columns: JSValue) !Signature {
    var fields = std.ArrayList(types.FieldType).init(bun.default_allocator);
    var name = try std.ArrayList(u8).initCapacity(bun.default_allocator, query.len);

    name.appendSliceAssumeCapacity(query);

    errdefer {
        fields.deinit();
        name.deinit();
    }

    var iter = try QueryBindingIterator.init(array_value, columns, globalObject);

    while (try iter.next()) |value| {
        if (value.isEmptyOrUndefinedOrNull()) {
            // Allow MySQL to decide the type
            try fields.append(.MYSQL_TYPE_NULL);
            try name.appendSlice(".null");
            continue;
        }

        const tag = try types.FieldType.fromJS(globalObject, value);
        try name.appendSlice(@tagName(tag));
        try fields.append(tag);
    }

    if (iter.anyFailed()) {
        return error.InvalidQueryBinding;
    }

    return Signature{
        .name = name.items,
        .fields = fields.items,
        .query = try bun.default_allocator.dupe(u8, query),
    };
}

const std = @import("std");
const bun = @import("bun");
const types = @import("../MySQLTypes.zig");
const FieldType = types.FieldType;
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const QueryBindingIterator = @import("../../shared/QueryBindingIterator.zig").QueryBindingIterator;
