const MySQLStatement = @This();
cached_structure: jsc.Strong.Optional = .empty,
ref_count: u32 = 1,
statement_id: u32 = 0,
params: []const types.FieldType = &[_]types.FieldType{},
// columns: []const protocol.ColumnDefinition41 = &[_]protocol.ColumnDefinition41{},
signature: Signature,
status: Status = Status.parsing,
// error_response: protocol.ErrorPacket = .{ .error_code = 0 },

pub const Status = enum {
    parsing,
    prepared,
    failed,
};

pub fn deinit(this: *MySQLStatement) void {
    debug("MySQLStatement deinit", .{});

    bun.assert(this.ref_count == 0);

    for (this.columns) |*column| {
        @constCast(column).deinit();
    }
    bun.default_allocator.free(this.columns);
    bun.default_allocator.free(this.params);
    this.cached_structure.deinit();
    this.error_response.deinit();
    this.signature.deinit();
    bun.default_allocator.destroy(this);
}

pub fn structure(this: *MySQLStatement, owner: JSValue, globalObject: *jsc.JSGlobalObject) JSValue {
    return this.cached_structure.get() orelse {
        const names = bun.default_allocator.alloc(bun.String, this.columns.len) catch return .undefined;
        defer {
            for (names) |*name| {
                name.deref();
            }
            bun.default_allocator.free(names);
        }
        for (this.columns, names) |*column, *name| {
            name.* = String.fromUTF8(column.name.slice());
        }
        const structure_ = jsc.JSObject.createStructure(
            globalObject,
            owner,
            @truncate(this.columns.len),
            names.ptr,
        );
        this.cached_structure.set(globalObject, structure_);
        return structure_;
    };
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const types = @import("./MySQLTypes.zig");
const Signature = @import("./protocol/Signature.zig");
const JSValue = jsc.JSValue;
const String = bun.String;
const debug = bun.Output.scoped(.MySQLStatement, false);
