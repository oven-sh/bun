// @sortImports

const PostgresSQLQuery = @This();
statement: ?*PostgresSQLStatement = null,
query: bun.String = bun.String.empty,
cursor_name: bun.String = bun.String.empty,

thisValue: JSRef = JSRef.empty(),

status: Status = Status.pending,

ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),

flags: packed struct(u8) {
    is_done: bool = false,
    binary: bool = false,
    bigint: bool = false,
    simple: bool = false,
    result_mode: PostgresSQLQueryResultMode = .objects,
    _padding: u2 = 0,
} = .{},

pub const js = JSC.Codegen.JSPostgresSQLQuery;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub fn getTarget(this: *PostgresSQLQuery, globalObject: *JSC.JSGlobalObject, clean_target: bool) JSC.JSValue {
    const thisValue = this.thisValue.get();
    if (thisValue == .zero) {
        return .zero;
    }
    const target = js.targetGetCached(thisValue) orelse return .zero;
    if (clean_target) {
        js.targetSetCached(thisValue, globalObject, .zero);
    }
    return target;
}

pub const Status = enum(u8) {
    /// The query was just enqueued, statement status can be checked for more details
    pending,
    /// The query is being bound to the statement
    binding,
    /// The query is running
    running,
    /// The query is waiting for a partial response
    partial_response,
    /// The query was successful
    success,
    /// The query failed
    fail,

    pub fn isRunning(this: Status) bool {
        return @intFromEnum(this) > @intFromEnum(Status.pending) and @intFromEnum(this) < @intFromEnum(Status.success);
    }
};

pub fn hasPendingActivity(this: *@This()) bool {
    return this.ref_count.load(.monotonic) > 1;
}

pub fn deinit(this: *@This()) void {
    this.thisValue.deinit();
    if (this.statement) |statement| {
        statement.deref();
    }
    this.query.deref();
    this.cursor_name.deref();
    bun.default_allocator.destroy(this);
}

pub fn finalize(this: *@This()) void {
    debug("PostgresSQLQuery finalize", .{});
    if (this.thisValue == .weak) {
        // clean up if is a weak reference, if is a strong reference we need to wait until the query is done
        // if we are a strong reference, here is probably a bug because GC'd should not happen
        this.thisValue.weak = .zero;
    }
    this.deref();
}

pub fn deref(this: *@This()) void {
    const ref_count = this.ref_count.fetchSub(1, .monotonic);

    if (ref_count == 1) {
        this.deinit();
    }
}

pub fn ref(this: *@This()) void {
    bun.assert(this.ref_count.fetchAdd(1, .monotonic) > 0);
}

pub fn onWriteFail(
    this: *@This(),
    err: AnyPostgresError,
    globalObject: *JSC.JSGlobalObject,
    queries_array: JSValue,
) void {
    this.status = .fail;
    const thisValue = this.thisValue.get();
    defer this.thisValue.deinit();
    const targetValue = this.getTarget(globalObject, true);
    if (thisValue == .zero or targetValue == .zero) {
        return;
    }

    const vm = JSC.VirtualMachine.get();
    const function = vm.rareData().postgresql_context.onQueryRejectFn.get().?;
    const event_loop = vm.eventLoop();
    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        postgresErrorToJS(globalObject, null, err),
        queries_array,
    });
}
pub fn onJSError(this: *@This(), err: JSC.JSValue, globalObject: *JSC.JSGlobalObject) void {
    this.status = .fail;
    this.ref();
    defer this.deref();

    const thisValue = this.thisValue.get();
    defer this.thisValue.deinit();
    const targetValue = this.getTarget(globalObject, true);
    if (thisValue == .zero or targetValue == .zero) {
        return;
    }

    var vm = JSC.VirtualMachine.get();
    const function = vm.rareData().postgresql_context.onQueryRejectFn.get().?;
    const event_loop = vm.eventLoop();
    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        err,
    });
}
pub fn onError(this: *@This(), err: PostgresSQLStatement.Error, globalObject: *JSC.JSGlobalObject) void {
    this.onJSError(err.toJS(globalObject), globalObject);
}

const CommandTag = union(enum) {
    // For an INSERT command, the tag is INSERT oid rows, where rows is the
    // number of rows inserted. oid used to be the object ID of the inserted
    // row if rows was 1 and the target table had OIDs, but OIDs system
    // columns are not supported anymore; therefore oid is always 0.
    INSERT: u64,
    // For a DELETE command, the tag is DELETE rows where rows is the number
    // of rows deleted.
    DELETE: u64,
    // For an UPDATE command, the tag is UPDATE rows where rows is the
    // number of rows updated.
    UPDATE: u64,
    // For a MERGE command, the tag is MERGE rows where rows is the number
    // of rows inserted, updated, or deleted.
    MERGE: u64,
    // For a SELECT or CREATE TABLE AS command, the tag is SELECT rows where
    // rows is the number of rows retrieved.
    SELECT: u64,
    // For a MOVE command, the tag is MOVE rows where rows is the number of
    // rows the cursor's position has been changed by.
    MOVE: u64,
    // For a FETCH command, the tag is FETCH rows where rows is the number
    // of rows that have been retrieved from the cursor.
    FETCH: u64,
    // For a COPY command, the tag is COPY rows where rows is the number of
    // rows copied. (Note: the row count appears only in PostgreSQL 8.2 and
    // later.)
    COPY: u64,

    other: []const u8,

    pub fn toJSTag(this: CommandTag, globalObject: *JSC.JSGlobalObject) JSValue {
        return switch (this) {
            .INSERT => JSValue.jsNumber(1),
            .DELETE => JSValue.jsNumber(2),
            .UPDATE => JSValue.jsNumber(3),
            .MERGE => JSValue.jsNumber(4),
            .SELECT => JSValue.jsNumber(5),
            .MOVE => JSValue.jsNumber(6),
            .FETCH => JSValue.jsNumber(7),
            .COPY => JSValue.jsNumber(8),
            .other => |tag| JSC.ZigString.init(tag).toJS(globalObject),
        };
    }

    pub fn toJSNumber(this: CommandTag) JSValue {
        return switch (this) {
            .other => JSValue.jsNumber(0),
            inline else => |val| JSValue.jsNumber(val),
        };
    }

    const KnownCommand = enum {
        INSERT,
        DELETE,
        UPDATE,
        MERGE,
        SELECT,
        MOVE,
        FETCH,
        COPY,

        pub const Map = bun.ComptimeEnumMap(KnownCommand);
    };

    pub fn init(tag: []const u8) CommandTag {
        const first_space_index = bun.strings.indexOfChar(tag, ' ') orelse return .{ .other = tag };
        const cmd = KnownCommand.Map.get(tag[0..first_space_index]) orelse return .{
            .other = tag,
        };

        const number = brk: {
            switch (cmd) {
                .INSERT => {
                    var remaining = tag[@min(first_space_index + 1, tag.len)..];
                    const second_space = bun.strings.indexOfChar(remaining, ' ') orelse return .{ .other = tag };
                    remaining = remaining[@min(second_space + 1, remaining.len)..];
                    break :brk std.fmt.parseInt(u64, remaining, 0) catch |err| {
                        debug("CommandTag failed to parse number: {s}", .{@errorName(err)});
                        return .{ .other = tag };
                    };
                },
                else => {
                    const after_tag = tag[@min(first_space_index + 1, tag.len)..];
                    break :brk std.fmt.parseInt(u64, after_tag, 0) catch |err| {
                        debug("CommandTag failed to parse number: {s}", .{@errorName(err)});
                        return .{ .other = tag };
                    };
                },
            }
        };

        switch (cmd) {
            inline else => |t| return @unionInit(CommandTag, @tagName(t), number),
        }
    }
};

pub fn allowGC(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject) void {
    if (thisValue == .zero) {
        return;
    }

    defer thisValue.ensureStillAlive();
    js.bindingSetCached(thisValue, globalObject, .zero);
    js.pendingValueSetCached(thisValue, globalObject, .zero);
    js.targetSetCached(thisValue, globalObject, .zero);
}

fn consumePendingValue(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject) ?JSValue {
    const pending_value = js.pendingValueGetCached(thisValue) orelse return null;
    js.pendingValueSetCached(thisValue, globalObject, .zero);
    return pending_value;
}

pub fn onResult(this: *@This(), command_tag_str: []const u8, globalObject: *JSC.JSGlobalObject, connection: JSC.JSValue, is_last: bool) void {
    this.ref();
    defer this.deref();

    const thisValue = this.thisValue.get();
    const targetValue = this.getTarget(globalObject, is_last);
    if (is_last) {
        this.status = .success;
    } else {
        this.status = .partial_response;
    }
    defer if (is_last) {
        allowGC(thisValue, globalObject);
        this.thisValue.deinit();
    };
    if (thisValue == .zero or targetValue == .zero) {
        return;
    }

    const vm = JSC.VirtualMachine.get();
    const function = vm.rareData().postgresql_context.onQueryResolveFn.get().?;
    const event_loop = vm.eventLoop();
    const tag = CommandTag.init(command_tag_str);

    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        consumePendingValue(thisValue, globalObject) orelse .js_undefined,
        tag.toJSTag(globalObject),
        tag.toJSNumber(),
        if (connection == .zero) .js_undefined else PostgresSQLConnection.js.queriesGetCached(connection) orelse .js_undefined,
        JSValue.jsBoolean(is_last),
    });
}

pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*PostgresSQLQuery {
    _ = callframe;
    return globalThis.throw("PostgresSQLQuery cannot be constructed directly", .{});
}

pub fn estimatedSize(this: *PostgresSQLQuery) usize {
    _ = this;
    return @sizeOf(PostgresSQLQuery);
}

pub fn call(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(6).slice();
    var args = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const query = args.nextEat() orelse {
        return globalThis.throw("query must be a string", .{});
    };
    const values = args.nextEat() orelse {
        return globalThis.throw("values must be an array", .{});
    };

    if (!query.isString()) {
        return globalThis.throw("query must be a string", .{});
    }

    if (values.jsType() != .Array) {
        return globalThis.throw("values must be an array", .{});
    }

    const pending_value: JSValue = args.nextEat() orelse .js_undefined;
    const columns: JSValue = args.nextEat() orelse .js_undefined;
    const js_bigint: JSValue = args.nextEat() orelse .false;
    const js_simple: JSValue = args.nextEat() orelse .false;

    const bigint = js_bigint.isBoolean() and js_bigint.asBoolean();
    const simple = js_simple.isBoolean() and js_simple.asBoolean();
    if (simple) {
        if (try values.getLength(globalThis) > 0) {
            return globalThis.throwInvalidArguments("simple query cannot have parameters", .{});
        }
        if (try query.getLength(globalThis) >= std.math.maxInt(i32)) {
            return globalThis.throwInvalidArguments("query is too long", .{});
        }
    }
    if (!pending_value.jsType().isArrayLike()) {
        return globalThis.throwInvalidArgumentType("query", "pendingValue", "Array");
    }

    var ptr = try bun.default_allocator.create(PostgresSQLQuery);

    const this_value = ptr.toJS(globalThis);
    this_value.ensureStillAlive();

    ptr.* = .{
        .query = try query.toBunString(globalThis),
        .thisValue = JSRef.initWeak(this_value),
        .flags = .{
            .bigint = bigint,
            .simple = simple,
        },
    };

    js.bindingSetCached(this_value, globalThis, values);
    js.pendingValueSetCached(this_value, globalThis, pending_value);
    if (!columns.isUndefined()) {
        js.columnsSetCached(this_value, globalThis, columns);
    }

    return this_value;
}

pub fn push(this: *PostgresSQLQuery, globalThis: *JSC.JSGlobalObject, value: JSValue) void {
    var pending_value = this.pending_value.get() orelse return;
    pending_value.push(globalThis, value);
}

pub fn doDone(this: *@This(), globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    _ = globalObject;
    this.flags.is_done = true;
    return .js_undefined;
}
pub fn setPendingValue(this: *PostgresSQLQuery, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const result = callframe.argument(0);
    js.pendingValueSetCached(this.thisValue.get(), globalObject, result);
    return .js_undefined;
}
pub fn setMode(this: *PostgresSQLQuery, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const js_mode = callframe.argument(0);
    if (js_mode.isEmptyOrUndefinedOrNull() or !js_mode.isNumber()) {
        return globalObject.throwInvalidArgumentType("setMode", "mode", "Number");
    }

    const mode = try js_mode.coerce(i32, globalObject);
    this.flags.result_mode = std.meta.intToEnum(PostgresSQLQueryResultMode, mode) catch {
        return globalObject.throwInvalidArgumentTypeValue("mode", "Number", js_mode);
    };
    return .js_undefined;
}

pub fn doRun(this: *PostgresSQLQuery, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    var arguments_ = callframe.arguments_old(2);
    const arguments = arguments_.slice();
    const connection: *PostgresSQLConnection = arguments[0].as(PostgresSQLConnection) orelse {
        return globalObject.throw("connection must be a PostgresSQLConnection", .{});
    };

    connection.poll_ref.ref(globalObject.bunVM());
    var query = arguments[1];

    if (!query.isObject()) {
        return globalObject.throwInvalidArgumentType("run", "query", "Query");
    }

    const this_value = callframe.this();
    const binding_value = js.bindingGetCached(this_value) orelse .zero;
    var query_str = this.query.toUTF8(bun.default_allocator);
    defer query_str.deinit();
    var writer = connection.writer();

    if (this.flags.simple) {
        debug("executeQuery", .{});

        const can_execute = !connection.hasQueryRunning();
        if (can_execute) {
            PostgresRequest.executeQuery(query_str.slice(), PostgresSQLConnection.Writer, writer) catch |err| {
                if (!globalObject.hasException())
                    return globalObject.throwValue(postgresErrorToJS(globalObject, "failed to execute query", err));
                return error.JSError;
            };
            connection.flags.is_ready_for_query = false;
            this.status = .running;
        } else {
            this.status = .pending;
        }
        const stmt = bun.default_allocator.create(PostgresSQLStatement) catch {
            return globalObject.throwOutOfMemory();
        };
        // Query is simple and it's the only owner of the statement
        stmt.* = .{
            .signature = Signature.empty(),
            .ref_count = 1,
            .status = .parsing,
        };
        this.statement = stmt;
        // We need a strong reference to the query so that it doesn't get GC'd
        connection.requests.writeItem(this) catch return globalObject.throwOutOfMemory();
        this.ref();
        this.thisValue.upgrade(globalObject);

        js.targetSetCached(this_value, globalObject, query);
        if (this.status == .running) {
            connection.flushDataAndResetTimeout();
        } else {
            connection.resetConnectionTimeout();
        }
        return .js_undefined;
    }

    const columns_value: JSValue = js.columnsGetCached(this_value) orelse .js_undefined;

    var signature = Signature.generate(globalObject, query_str.slice(), binding_value, columns_value, connection.prepared_statement_id, connection.flags.use_unnamed_prepared_statements) catch |err| {
        if (!globalObject.hasException())
            return globalObject.throwError(err, "failed to generate signature");
        return error.JSError;
    };

    const has_params = signature.fields.len > 0;
    var did_write = false;
    enqueue: {
        var connection_entry_value: ?**PostgresSQLStatement = null;
        if (!connection.flags.use_unnamed_prepared_statements) {
            const entry = connection.statements.getOrPut(bun.default_allocator, bun.hash(signature.name)) catch |err| {
                signature.deinit();
                return globalObject.throwError(err, "failed to allocate statement");
            };
            connection_entry_value = entry.value_ptr;
            if (entry.found_existing) {
                this.statement = connection_entry_value.?.*;
                this.statement.?.ref();
                signature.deinit();

                switch (this.statement.?.status) {
                    .failed => {
                        // If the statement failed, we need to throw the error
                        return globalObject.throwValue(this.statement.?.error_response.?.toJS(globalObject));
                    },
                    .prepared => {
                        if (!connection.hasQueryRunning()) {
                            this.flags.binary = this.statement.?.fields.len > 0;
                            debug("bindAndExecute", .{});

                            // bindAndExecute will bind + execute, it will change to running after binding is complete
                            PostgresRequest.bindAndExecute(globalObject, this.statement.?, binding_value, columns_value, PostgresSQLConnection.Writer, writer) catch |err| {
                                if (!globalObject.hasException())
                                    return globalObject.throwValue(postgresErrorToJS(globalObject, "failed to bind and execute query", err));
                                return error.JSError;
                            };
                            connection.flags.is_ready_for_query = false;
                            this.status = .binding;

                            did_write = true;
                        }
                    },
                    .parsing, .pending => {},
                }

                break :enqueue;
            }
        }
        const can_execute = !connection.hasQueryRunning();

        if (can_execute) {
            // If it does not have params, we can write and execute immediately in one go
            if (!has_params) {
                debug("prepareAndQueryWithSignature", .{});
                // prepareAndQueryWithSignature will write + bind + execute, it will change to running after binding is complete
                PostgresRequest.prepareAndQueryWithSignature(globalObject, query_str.slice(), binding_value, PostgresSQLConnection.Writer, writer, &signature) catch |err| {
                    signature.deinit();
                    if (!globalObject.hasException())
                        return globalObject.throwValue(postgresErrorToJS(globalObject, "failed to prepare and query", err));
                    return error.JSError;
                };
                connection.flags.is_ready_for_query = false;
                this.status = .binding;
                did_write = true;
            } else {
                debug("writeQuery", .{});

                PostgresRequest.writeQuery(query_str.slice(), signature.prepared_statement_name, signature.fields, PostgresSQLConnection.Writer, writer) catch |err| {
                    signature.deinit();
                    if (!globalObject.hasException())
                        return globalObject.throwValue(postgresErrorToJS(globalObject, "failed to write query", err));
                    return error.JSError;
                };
                writer.write(&protocol.Sync) catch |err| {
                    signature.deinit();
                    if (!globalObject.hasException())
                        return globalObject.throwValue(postgresErrorToJS(globalObject, "failed to flush", err));
                    return error.JSError;
                };
                connection.flags.is_ready_for_query = false;
                did_write = true;
            }
        }
        {
            const stmt = bun.default_allocator.create(PostgresSQLStatement) catch {
                return globalObject.throwOutOfMemory();
            };
            // we only have connection_entry_value if we are using named prepared statements
            if (connection_entry_value) |entry_value| {
                connection.prepared_statement_id += 1;
                stmt.* = .{ .signature = signature, .ref_count = 2, .status = if (can_execute) .parsing else .pending };
                this.statement = stmt;

                entry_value.* = stmt;
            } else {
                stmt.* = .{ .signature = signature, .ref_count = 1, .status = if (can_execute) .parsing else .pending };
                this.statement = stmt;
            }
        }
    }
    // We need a strong reference to the query so that it doesn't get GC'd
    connection.requests.writeItem(this) catch return globalObject.throwOutOfMemory();
    this.ref();
    this.thisValue.upgrade(globalObject);

    js.targetSetCached(this_value, globalObject, query);
    if (did_write) {
        connection.flushDataAndResetTimeout();
    } else {
        connection.resetConnectionTimeout();
    }
    return .js_undefined;
}

pub fn doCancel(this: *PostgresSQLQuery, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    _ = callframe;
    _ = globalObject;
    _ = this;

    return .js_undefined;
}

comptime {
    const jscall = JSC.toJSHostFn(call);
    @export(&jscall, .{ .name = "PostgresSQLQuery__createInstance" });
}

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const PostgresSQLStatement = @import("./PostgresSQLStatement.zig");
const JSRef = JSC.JSRef;
const PostgresSQLQueryResultMode = @import("./PostgresSQLQueryResultMode.zig").PostgresSQLQueryResultMode;
const PostgresSQLConnection = @import("./PostgresSQLConnection.zig");
const AnyPostgresError = @import("./AnyPostgresError.zig").AnyPostgresError;
const postgresErrorToJS = @import("./AnyPostgresError.zig").postgresErrorToJS;
const debug = bun.Output.scoped(.Postgres, false);
const PostgresRequest = @import("./PostgresRequest.zig");
const Signature = @import("./Signature.zig");
const protocol = @import("./PostgresProtocol.zig");
