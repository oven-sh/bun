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

    errdefer {
        fields.deinit();
    }

    var iter = try QueryBindingIterator.init(array_value, columns, globalObject);

    while (try iter.next()) |value| {
        if (value.isEmptyOrUndefinedOrNull()) {
            // Allow MySQL to decide the type
            try fields.append(.{ .type = .MYSQL_TYPE_NULL, .flags = .{} });
            continue;
        }
        var unsigned = false;
        const tag = try types.FieldType.fromJS(globalObject, value, &unsigned);
        // TODO: add flags if necessary right now the only relevant would be unsigned but is JS and is never unsigned
        try fields.append(.{ .type = tag, .flags = .{ .UNSIGNED = unsigned } });
    }

    if (iter.anyFailed()) {
        return error.InvalidQueryBinding;
    }

    // The statement cache key (`signature.name`) is just the SQL text — do not
    // depend on the runtime null/type pattern of the bound values. Otherwise
    // each distinct null pattern in a bulk insert allocates a fresh server-side
    // prepared statement and leaks memory on the database for the life of the
    // connection. See issue #28980.
    //
    // MySQL `COM_STMT_PREPARE` takes only the query text, and parameter types
    // are carried in the type-header of each `COM_STMT_EXECUTE`, so the per-
    // parameter tag does not need to be encoded into the cache key.
    const name = try bun.default_allocator.dupe(u8, query);
    errdefer bun.default_allocator.free(name);

    const query_copy = try bun.default_allocator.dupe(u8, query);

    return Signature{
        .name = name,
        .fields = fields.items,
        .query = query_copy,
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
