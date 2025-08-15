const MySQLStatement = @This();
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
cached_structure: CachedStructure = .{},
ref_count: RefCount = RefCount.init(),
statement_id: u32 = 0,
params: []types.FieldType = &[_]types.FieldType{},
columns: []ColumnDefinition41 = &[_]ColumnDefinition41{},
columns_received: u32 = 0,
signature: Signature,
status: Status = Status.parsing,
error_response: ErrorPacket = .{ .error_code = 0 },

pub const Status = enum {
    parsing,
    prepared,
    failed,
};

pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub fn deinit(this: *MySQLStatement) void {
    debug("MySQLStatement deinit", .{});

    for (this.columns) |*column| {
        column.deinit();
    }
    if (this.columns.len > 0) {
        bun.default_allocator.free(this.columns);
    }
    if (this.params.len > 0) {
        bun.default_allocator.free(this.params);
    }
    this.cached_structure.deinit();
    this.error_response.deinit();
    this.signature.deinit();
    bun.default_allocator.destroy(this);
}

pub fn structure(this: *MySQLStatement, owner: JSValue, globalObject: *jsc.JSGlobalObject) CachedStructure {
    if (this.cached_structure.has()) {
        return this.cached_structure;
    }
    // this.checkForDuplicateFields();

    // lets avoid most allocations
    var stack_ids: [70]jsc.JSObject.ExternColumnIdentifier = undefined;
    // lets de duplicate the fields early
    // var nonDuplicatedCount = this.columns.len;
    const nonDuplicatedCount = this.columns.len;
    // for (this.fields) |*field| {
    //     if (field.name_or_index == .duplicate) {
    //         nonDuplicatedCount -= 1;
    //     }
    // }
    const ids = if (nonDuplicatedCount <= jsc.JSObject.maxInlineCapacity()) stack_ids[0..nonDuplicatedCount] else bun.default_allocator.alloc(jsc.JSObject.ExternColumnIdentifier, nonDuplicatedCount) catch bun.outOfMemory();

    for (this.columns, 0..) |*column, i| {
        var id: *jsc.JSObject.ExternColumnIdentifier = &ids[i];
        id.value.name = String.createAtomIfPossible(column.name.slice());
        id.tag = 2;
    }

    if (nonDuplicatedCount > jsc.JSObject.maxInlineCapacity()) {
        this.cached_structure.set(globalObject, null, ids);
    } else {
        this.cached_structure.set(globalObject, jsc.JSObject.createStructure(
            globalObject,
            owner,
            @truncate(ids.len),
            ids.ptr,
        ), null);
    }

    return this.cached_structure;
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const types = @import("./MySQLTypes.zig");
const Signature = @import("./protocol/Signature.zig");
const ColumnDefinition41 = @import("./protocol/ColumnDefinition41.zig");
const ErrorPacket = @import("./protocol/ErrorPacket.zig");
const JSValue = jsc.JSValue;
const String = bun.String;
const debug = bun.Output.scoped(.MySQLStatement, false);
const CachedStructure = @import("../shared/CachedStructure.zig");
