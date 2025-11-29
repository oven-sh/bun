const Signature = @This();
fields: []Param = &.{},
name: []const u8 = "",
query: []const u8 = "",

pub fn empty() Signature {
    return Signature{
        .fields = &.{},
        .name = "",
        .query = "",
    };
}

pub fn deinit(this: *Signature) void {
    if (this.fields.len > 0) {
        bun.default_allocator.free(this.fields);
    }
    if (this.name.len > 0) {
        bun.default_allocator.free(this.name);
    }
    if (this.query.len > 0) {
        bun.default_allocator.free(this.query);
    }
}

pub fn hash(this: *const Signature) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(this.name);
    hasher.update(std.mem.sliceAsBytes(this.fields));
    return hasher.final();
}

pub fn generate(globalObject: *jsc.JSGlobalObject, query: []const u8, array_value: JSValue, columns: JSValue) !Signature {
    var fields = std.array_list.Managed(Param).init(bun.default_allocator);
    var name = try std.array_list.Managed(u8).initCapacity(bun.default_allocator, query.len);

    name.appendSliceAssumeCapacity(query);

    errdefer {
        fields.deinit();
        name.deinit();
    }

    var iter = try QueryBindingIterator.init(array_value, columns, globalObject);

    while (try iter.next()) |value| {
        if (value.isEmptyOrUndefinedOrNull()) {
            // Allow MySQL to decide the type
            try fields.append(.{ .type = .MYSQL_TYPE_NULL, .flags = .{} });
            try name.appendSlice(".null");
            continue;
        }
        var unsigned = false;
        const tag = try types.FieldType.fromJS(globalObject, value, &unsigned);
        if (unsigned) {
            // 128 is more than enought right now
            var tag_name_buf = [_]u8{0} ** 128;
            try name.appendSlice(std.fmt.bufPrint(tag_name_buf[0..], "U{s}", .{@tagName(tag)}) catch @tagName(tag));
        } else {
            try name.appendSlice(@tagName(tag));
        }
        // TODO: add flags if necessary right now the only relevant would be unsigned but is JS and is never unsigned
        try fields.append(.{ .type = tag, .flags = .{ .UNSIGNED = unsigned } });
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

const bun = @import("bun");
const std = @import("std");
const Param = @import("../MySQLStatement.zig").Param;
const QueryBindingIterator = @import("../../shared/QueryBindingIterator.zig").QueryBindingIterator;

const types = @import("../MySQLTypes.zig");
const FieldType = types.FieldType;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
