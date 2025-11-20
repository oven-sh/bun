const MySQLStatement = @This();
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});

cached_structure: CachedStructure = .{},
ref_count: RefCount = RefCount.init(),
statement_id: u32 = 0,
params: []Param = &[_]Param{},
params_received: u32 = 0,

columns: []ColumnDefinition41 = &[_]ColumnDefinition41{},
columns_received: u32 = 0,

signature: Signature,
status: Status = Status.parsing,
error_response: ErrorPacket = .{ .error_code = 0 },
execution_flags: ExecutionFlags = .{},
fields_flags: SQLDataCell.Flags = .{},
result_count: u64 = 0,

pub const ExecutionFlags = packed struct(u8) {
    header_received: bool = false,
    needs_duplicate_check: bool = true,
    need_to_send_params: bool = true,
    _: u5 = 0,
};

pub const Status = enum {
    pending,
    parsing,
    prepared,
    failed,
};

pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub fn reset(this: *MySQLStatement) void {
    this.result_count = 0;
    this.columns_received = 0;
    this.execution_flags = .{};
}

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
    bun.destroy(this);
}

pub fn checkForDuplicateFields(this: *@This()) void {
    if (!this.execution_flags.needs_duplicate_check) return;
    this.execution_flags.needs_duplicate_check = false;

    var seen_numbers = std.array_list.Managed(u32).init(bun.default_allocator);
    defer seen_numbers.deinit();
    var seen_fields = bun.StringHashMap(void).init(bun.default_allocator);
    bun.handleOom(seen_fields.ensureUnusedCapacity(@intCast(this.columns.len)));
    defer seen_fields.deinit();

    // iterate backwards
    var remaining = this.columns.len;
    var flags: SQLDataCell.Flags = .{};
    while (remaining > 0) {
        remaining -= 1;
        const field: *ColumnDefinition41 = &this.columns[remaining];
        switch (field.name_or_index) {
            .name => |*name| {
                const seen = seen_fields.getOrPut(name.slice()) catch unreachable;
                if (seen.found_existing) {
                    field.name_or_index = .duplicate;
                    flags.has_duplicate_columns = true;
                }

                flags.has_named_columns = true;
            },
            .index => |index| {
                if (std.mem.indexOfScalar(u32, seen_numbers.items, index) != null) {
                    field.name_or_index = .duplicate;
                    flags.has_duplicate_columns = true;
                } else {
                    bun.handleOom(seen_numbers.append(index));
                }

                flags.has_indexed_columns = true;
            },
            .duplicate => {
                flags.has_duplicate_columns = true;
            },
        }
    }

    this.fields_flags = flags;
}

pub fn structure(this: *MySQLStatement, owner: JSValue, globalObject: *jsc.JSGlobalObject) CachedStructure {
    if (this.cached_structure.has()) {
        return this.cached_structure;
    }
    this.checkForDuplicateFields();

    // lets avoid most allocations
    var stack_ids: [70]jsc.JSObject.ExternColumnIdentifier = [_]jsc.JSObject.ExternColumnIdentifier{.{ .tag = 0, .value = .{ .index = 0 } }} ** 70;
    // lets de duplicate the fields early
    var nonDuplicatedCount = this.columns.len;
    for (this.columns) |*column| {
        if (column.name_or_index == .duplicate) {
            nonDuplicatedCount -= 1;
        }
    }
    const ids = if (nonDuplicatedCount <= jsc.JSObject.maxInlineCapacity()) stack_ids[0..nonDuplicatedCount] else bun.handleOom(bun.default_allocator.alloc(jsc.JSObject.ExternColumnIdentifier, nonDuplicatedCount));

    var i: usize = 0;
    for (this.columns) |*column| {
        if (column.name_or_index == .duplicate) continue;

        var id: *jsc.JSObject.ExternColumnIdentifier = &ids[i];
        switch (column.name_or_index) {
            .name => |name| {
                id.value.name = String.createAtomIfPossible(name.slice());
            },
            .index => |index| {
                id.value.index = index;
            },
            .duplicate => unreachable,
        }

        id.tag = switch (column.name_or_index) {
            .name => 2,
            .index => 1,
            .duplicate => 0,
        };

        i += 1;
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
pub const Param = struct {
    type: types.FieldType,
    flags: ColumnDefinition41.ColumnFlags,
};
const debug = bun.Output.scoped(.MySQLStatement, .hidden);

const CachedStructure = @import("../shared/CachedStructure.zig");
const ColumnDefinition41 = @import("./protocol/ColumnDefinition41.zig");
const ErrorPacket = @import("./protocol/ErrorPacket.zig");
const Signature = @import("./protocol/Signature.zig");
const std = @import("std");
const types = @import("./MySQLTypes.zig");
const SQLDataCell = @import("../shared/SQLDataCell.zig").SQLDataCell;

const bun = @import("bun");
const String = bun.String;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
