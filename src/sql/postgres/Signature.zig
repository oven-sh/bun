const Signature = @This();

fields: []const int4,
name: []const u8,
query: []const u8,
prepared_statement_name: []const u8,

pub fn empty() Signature {
    return Signature{
        .fields = &[_]int4{},
        .name = &[_]u8{},
        .query = &[_]u8{},
        .prepared_statement_name = &[_]u8{},
    };
}

pub fn deinit(this: *Signature) void {
    if (this.prepared_statement_name.len > 0) {
        bun.default_allocator.free(this.prepared_statement_name);
    }
    if (this.name.len > 0) {
        bun.default_allocator.free(this.name);
    }
    if (this.fields.len > 0) {
        bun.default_allocator.free(this.fields);
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

pub fn generate(globalObject: *jsc.JSGlobalObject, query: []const u8, array_value: JSValue, columns: JSValue, prepared_statement_id: u64, unnamed: bool) !Signature {
    var fields = std.array_list.Managed(int4).init(bun.default_allocator);
    var name = try std.array_list.Managed(u8).initCapacity(bun.default_allocator, query.len);

    name.appendSliceAssumeCapacity(query);

    errdefer {
        fields.deinit();
        name.deinit();
    }

    var iter = try QueryBindingIterator.init(array_value, columns, globalObject);

    while (try iter.next()) |value| {
        if (value.isEmptyOrUndefinedOrNull()) {
            // Allow postgres to decide the type
            try fields.append(0);
            try name.appendSlice(".null");
            continue;
        }

        const tag = try types.Tag.fromJS(globalObject, value);

        switch (tag) {
            .int8 => try name.appendSlice(".int8"),
            .int4 => try name.appendSlice(".int4"),
            // .int4_array => try name.appendSlice(".int4_array"),
            .int2 => try name.appendSlice(".int2"),
            .float8 => try name.appendSlice(".float8"),
            .float4 => try name.appendSlice(".float4"),
            .numeric => try name.appendSlice(".numeric"),
            .json, .jsonb => try name.appendSlice(".json"),
            .bool => try name.appendSlice(".bool"),
            .timestamp => try name.appendSlice(".timestamp"),
            .timestamptz => try name.appendSlice(".timestamptz"),
            .bytea => try name.appendSlice(".bytea"),
            else => try name.appendSlice(".string"),
        }

        switch (tag) {
            .bool, .int4, .int8, .float8, .int2, .numeric, .float4, .bytea => {
                // We decide the type
                try fields.append(@intFromEnum(tag));
            },
            else => {
                // Allow postgres to decide the type
                try fields.append(0);
            },
        }
    }

    if (iter.anyFailed()) {
        return error.InvalidQueryBinding;
    }
    // max u64 length is 20, max prepared_statement_name length is 63
    const prepared_statement_name = if (unnamed) "" else try std.fmt.allocPrint(bun.default_allocator, "P{s}${d}", .{ name.items[0..@min(40, name.items.len)], prepared_statement_id });

    return Signature{
        .prepared_statement_name = prepared_statement_name,
        .name = name.items,
        .fields = fields.items,
        .query = try bun.default_allocator.dupe(u8, query),
    };
}

const bun = @import("bun");
const std = @import("std");
const QueryBindingIterator = @import("../shared/QueryBindingIterator.zig").QueryBindingIterator;

const types = @import("./PostgresTypes.zig");
const int4 = types.int4;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
