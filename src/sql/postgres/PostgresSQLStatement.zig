const PostgresSQLStatement = @This();
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
cached_structure: PostgresCachedStructure = .{},
ref_count: RefCount = RefCount.init(),
fields: []protocol.FieldDescription = &[_]protocol.FieldDescription{},
parameters: []const int4 = &[_]int4{},
signature: Signature,
status: Status = Status.pending,
error_response: ?Error = null,
needs_duplicate_check: bool = true,
fields_flags: DataCell.Flags = .{},
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const Error = union(enum) {
    protocol: protocol.ErrorResponse,
    postgres_error: AnyPostgresError,

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .protocol => |*err| err.deinit(),
            .postgres_error => {},
        }
    }

    pub fn toJS(this: *const @This(), globalObject: *jsc.JSGlobalObject) JSError!JSValue {
        return switch (this.*) {
            .protocol => |err| err.toJS(globalObject),
            .postgres_error => |err| postgresErrorToJS(globalObject, null, err),
        };
    }
};

pub const Status = enum {
    pending,
    parsing,
    prepared,
    failed,

    pub fn isRunning(this: @This()) bool {
        return this == .parsing;
    }
};

pub fn checkForDuplicateFields(this: *PostgresSQLStatement) void {
    if (!this.needs_duplicate_check) return;
    this.needs_duplicate_check = false;

    var seen_numbers = std.array_list.Managed(u32).init(bun.default_allocator);
    defer seen_numbers.deinit();
    var seen_fields = bun.StringHashMap(void).init(bun.default_allocator);
    bun.handleOom(seen_fields.ensureUnusedCapacity(@intCast(this.fields.len)));
    defer seen_fields.deinit();

    // iterate backwards
    var remaining = this.fields.len;
    var flags: DataCell.Flags = .{};
    while (remaining > 0) {
        remaining -= 1;
        const field: *protocol.FieldDescription = &this.fields[remaining];
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

pub fn deinit(this: *PostgresSQLStatement) void {
    debug("PostgresSQLStatement deinit", .{});

    this.ref_count.assertNoRefs();

    for (this.fields) |*field| {
        field.deinit();
    }
    bun.default_allocator.free(this.fields);
    bun.default_allocator.free(this.parameters);
    this.cached_structure.deinit();
    if (this.error_response) |err| {
        this.error_response = null;
        var _error = err;
        _error.deinit();
    }
    this.signature.deinit();
    bun.default_allocator.destroy(this);
}

pub fn structure(this: *PostgresSQLStatement, owner: JSValue, globalObject: *jsc.JSGlobalObject) PostgresCachedStructure {
    if (this.cached_structure.has()) {
        return this.cached_structure;
    }
    this.checkForDuplicateFields();

    // lets avoid most allocations
    var stack_ids: [70]jsc.JSObject.ExternColumnIdentifier = undefined;
    // lets de duplicate the fields early
    var nonDuplicatedCount = this.fields.len;
    for (this.fields) |*field| {
        if (field.name_or_index == .duplicate) {
            nonDuplicatedCount -= 1;
        }
    }
    const ids = if (nonDuplicatedCount <= jsc.JSObject.maxInlineCapacity()) stack_ids[0..nonDuplicatedCount] else bun.handleOom(bun.default_allocator.alloc(jsc.JSObject.ExternColumnIdentifier, nonDuplicatedCount));

    var i: usize = 0;
    for (this.fields) |*field| {
        if (field.name_or_index == .duplicate) continue;

        var id: *jsc.JSObject.ExternColumnIdentifier = &ids[i];
        switch (field.name_or_index) {
            .name => |name| {
                id.value.name = String.createAtomIfPossible(name.slice());
            },
            .index => |index| {
                id.value.index = index;
            },
            .duplicate => unreachable,
        }
        id.tag = switch (field.name_or_index) {
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

const debug = bun.Output.scoped(.Postgres, .visible);

const PostgresCachedStructure = @import("../shared/CachedStructure.zig");
const Signature = @import("./Signature.zig");
const protocol = @import("./PostgresProtocol.zig");
const std = @import("std");
const DataCell = @import("./DataCell.zig").SQLDataCell;

const AnyPostgresError = @import("./AnyPostgresError.zig").AnyPostgresError;
const postgresErrorToJS = @import("./AnyPostgresError.zig").postgresErrorToJS;

const types = @import("./PostgresTypes.zig");
const int4 = types.int4;

const bun = @import("bun");
const JSError = bun.JSError;
const String = bun.String;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
