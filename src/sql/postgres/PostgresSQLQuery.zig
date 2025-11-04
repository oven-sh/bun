const PostgresSQLQuery = @This();
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
statement: ?*PostgresSQLStatement = null,
query: bun.String = bun.String.empty,
cursor_name: bun.String = bun.String.empty,

thisValue: JSRef = JSRef.empty(),

status: Status = Status.pending,

ref_count: RefCount = RefCount.init(),

flags: packed struct(u8) {
    is_done: bool = false,
    binary: bool = false,
    bigint: bool = false,
    simple: bool = false,
    pipelined: bool = false,
    result_mode: PostgresSQLQueryResultMode = .objects,
    _padding: u1 = 0,
} = .{},

pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub fn getTarget(this: *PostgresSQLQuery, globalObject: *jsc.JSGlobalObject, clean_target: bool) ?jsc.JSValue {
    const thisValue = this.thisValue.tryGet() orelse return null;
    const target = js.targetGetCached(thisValue) orelse return null;
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

pub fn deinit(this: *@This()) void {
    if (this.statement) |statement| {
        statement.deref();
    }
    this.query.deref();
    this.cursor_name.deref();
    bun.default_allocator.destroy(this);
}

pub fn finalize(this: *@This()) void {
    debug("PostgresSQLQuery finalize", .{});
    this.thisValue.finalize();
    this.deref();
}

pub fn onWriteFail(
    this: *@This(),
    err: AnyPostgresError,
    globalObject: *jsc.JSGlobalObject,
    queries_array: JSValue,
) void {
    this.ref();
    defer this.deref();
    this.status = .fail;
    const thisValue = this.thisValue.tryGet() orelse return;
    defer this.thisValue.downgrade();
    const targetValue = this.getTarget(globalObject, true) orelse return;

    const vm = jsc.VirtualMachine.get();
    const function = vm.rareData().postgresql_context.onQueryRejectFn.get().?;
    const event_loop = vm.eventLoop();
    const js_err = postgresErrorToJS(globalObject, null, err);
    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        js_err.toError() orelse js_err,
        queries_array,
    });
}
pub fn onJSError(this: *@This(), err: jsc.JSValue, globalObject: *jsc.JSGlobalObject) void {
    this.ref();
    defer this.deref();
    this.status = .fail;
    const thisValue = this.thisValue.tryGet() orelse return;
    defer this.thisValue.downgrade();
    const targetValue = this.getTarget(globalObject, true) orelse return;

    var vm = jsc.VirtualMachine.get();
    const function = vm.rareData().postgresql_context.onQueryRejectFn.get().?;
    const event_loop = vm.eventLoop();
    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        err.toError() orelse err,
    });
}
pub fn onError(this: *@This(), err: PostgresSQLStatement.Error, globalObject: *jsc.JSGlobalObject) void {
    const e = err.toJS(globalObject) catch return;
    this.onJSError(e, globalObject);
}

pub fn allowGC(thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject) void {
    if (thisValue == .zero) {
        return;
    }

    defer thisValue.ensureStillAlive();
    js.bindingSetCached(thisValue, globalObject, .zero);
    js.pendingValueSetCached(thisValue, globalObject, .zero);
    js.targetSetCached(thisValue, globalObject, .zero);
}

fn consumePendingValue(thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject) ?JSValue {
    const pending_value = js.pendingValueGetCached(thisValue) orelse return null;
    js.pendingValueSetCached(thisValue, globalObject, .zero);
    return pending_value;
}

pub fn onResult(this: *@This(), command_tag_str: []const u8, globalObject: *jsc.JSGlobalObject, connection: jsc.JSValue, is_last: bool) void {
    this.ref();
    defer this.deref();
    if (is_last) {
        this.status = .success;
    } else {
        this.status = .partial_response;
    }
    const tag = CommandTag.init(command_tag_str);
    const js_tag = tag.toJSTag(globalObject) catch |e| return this.onJSError(globalObject.takeException(e), globalObject);
    js_tag.ensureStillAlive();

    const thisValue = this.thisValue.tryGet() orelse return;
    defer if (is_last) {
        allowGC(thisValue, globalObject);
        this.thisValue.downgrade();
    };
    const targetValue = this.getTarget(globalObject, is_last) orelse return;

    const vm = jsc.VirtualMachine.get();
    const function = vm.rareData().postgresql_context.onQueryResolveFn.get().?;
    const event_loop = vm.eventLoop();

    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        consumePendingValue(thisValue, globalObject) orelse .js_undefined,
        js_tag,
        tag.toJSNumber(),
        if (connection == .zero) .js_undefined else PostgresSQLConnection.js.queriesGetCached(connection) orelse .js_undefined,
        JSValue.jsBoolean(is_last),
    });
}

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*PostgresSQLQuery {
    _ = callframe;
    return globalThis.throw("PostgresSQLQuery cannot be constructed directly", .{});
}

pub fn estimatedSize(this: *PostgresSQLQuery) usize {
    _ = this;
    return @sizeOf(PostgresSQLQuery);
}

pub fn call(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
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

pub fn push(this: *PostgresSQLQuery, globalThis: *jsc.JSGlobalObject, value: JSValue) void {
    var pending_value = this.pending_value.get() orelse return;
    pending_value.push(globalThis, value);
}

pub fn doDone(this: *@This(), globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    _ = globalObject;
    this.flags.is_done = true;
    return .js_undefined;
}
pub fn setPendingValueFromJS(_: *PostgresSQLQuery, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const result = callframe.argument(0);
    const thisValue = callframe.this();
    js.pendingValueSetCached(thisValue, globalObject, result);
    return .js_undefined;
}
pub fn setModeFromJS(this: *PostgresSQLQuery, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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

pub fn doRun(this: *PostgresSQLQuery, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    var arguments = callframe.arguments();
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
    // We need a strong reference to the query so that it doesn't get GC'd
    this.ref();
    if (this.flags.simple) {
        debug("executeQuery", .{});

        const stmt = bun.default_allocator.create(PostgresSQLStatement) catch {
            this.deref();
            return globalObject.throwOutOfMemory();
        };
        // Query is simple and it's the only owner of the statement
        stmt.* = .{
            .signature = Signature.empty(),
            .status = .parsing,
        };
        this.statement = stmt;

        const can_execute = !connection.hasQueryRunning();
        if (can_execute) {
            PostgresRequest.executeQuery(query_str.slice(), PostgresSQLConnection.Writer, writer) catch |err| {
                // fail to run do cleanup
                this.statement = null;
                bun.default_allocator.destroy(stmt);
                this.deref();

                if (!globalObject.hasException())
                    return globalObject.throwValue(postgresErrorToJS(globalObject, "failed to execute query", err));
                return error.JSError;
            };
            connection.flags.is_ready_for_query = false;
            connection.nonpipelinable_requests += 1;
            this.status = .running;
        } else {
            this.status = .pending;
        }
        connection.requests.writeItem(this) catch {
            // fail to run do cleanup
            this.statement = null;
            bun.default_allocator.destroy(stmt);
            this.deref();

            return globalObject.throwOutOfMemory();
        };

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
        this.deref();
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
                const stmt = connection_entry_value.?.*;
                this.statement = stmt;
                stmt.ref();
                signature.deinit();

                switch (stmt.status) {
                    .failed => {
                        this.statement = null;
                        const error_response = try stmt.error_response.?.toJS(globalObject);
                        stmt.deref();
                        this.deref();
                        return globalObject.throwValue(error_response);
                    },
                    .prepared => {
                        if (!connection.hasQueryRunning() or connection.canPipeline()) {
                            this.flags.binary = this.statement.?.fields.len > 0;
                            debug("bindAndExecute", .{});

                            // bindAndExecute will bind + execute, it will change to running after binding is complete
                            PostgresRequest.bindAndExecute(globalObject, this.statement.?, binding_value, columns_value, PostgresSQLConnection.Writer, writer) catch |err| {
                                // fail to run do cleanup
                                this.statement = null;
                                stmt.deref();
                                this.deref();

                                if (!globalObject.hasException())
                                    return globalObject.throwValue(postgresErrorToJS(globalObject, "failed to bind and execute query", err));
                                return error.JSError;
                            };
                            connection.flags.is_ready_for_query = false;
                            this.status = .binding;
                            this.flags.pipelined = true;
                            connection.pipelined_requests += 1;

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
                    if (this.statement) |stmt| {
                        this.statement = null;
                        stmt.deref();
                    }
                    this.deref();
                    if (!globalObject.hasException())
                        return globalObject.throwValue(postgresErrorToJS(globalObject, "failed to prepare and query", err));
                    return error.JSError;
                };
                connection.flags.is_ready_for_query = false;
                this.status = .binding;
                did_write = true;
                connection.flags.waiting_to_prepare = true;
            } else {
                debug("writeQuery", .{});

                PostgresRequest.writeQuery(query_str.slice(), signature.prepared_statement_name, signature.fields, PostgresSQLConnection.Writer, writer) catch |err| {
                    signature.deinit();
                    if (this.statement) |stmt| {
                        this.statement = null;
                        stmt.deref();
                    }
                    this.deref();
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
                connection.flags.waiting_to_prepare = true;
            }
        }
        {
            const stmt = bun.default_allocator.create(PostgresSQLStatement) catch {
                this.deref();
                return globalObject.throwOutOfMemory();
            };
            // we only have connection_entry_value if we are using named prepared statements
            if (connection_entry_value) |entry_value| {
                connection.prepared_statement_id += 1;
                stmt.* = .{
                    .signature = signature,
                    .ref_count = .initExactRefs(2),
                    .status = if (can_execute) .parsing else .pending,
                };
                this.statement = stmt;

                entry_value.* = stmt;
            } else {
                stmt.* = .{
                    .signature = signature,
                    .status = if (can_execute) .parsing else .pending,
                };
                this.statement = stmt;
            }
        }
    }

    connection.requests.writeItem(this) catch return globalObject.throwOutOfMemory();
    this.thisValue.upgrade(globalObject);

    js.targetSetCached(this_value, globalObject, query);
    if (did_write) {
        connection.flushDataAndResetTimeout();
    } else {
        connection.resetConnectionTimeout();
    }
    return .js_undefined;
}

pub fn doCancel(this: *PostgresSQLQuery, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    _ = callframe;
    _ = globalObject;
    _ = this;

    return .js_undefined;
}

comptime {
    const jscall = jsc.toJSHostFn(call);
    @export(&jscall, .{ .name = "PostgresSQLQuery__createInstance" });
}

const debug = bun.Output.scoped(.Postgres, .visible);

pub const js = jsc.Codegen.JSPostgresSQLQuery;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;

const PostgresRequest = @import("./PostgresRequest.zig");
const PostgresSQLConnection = @import("./PostgresSQLConnection.zig");
const PostgresSQLStatement = @import("./PostgresSQLStatement.zig");
const Signature = @import("./Signature.zig");
const bun = @import("bun");
const protocol = @import("./PostgresProtocol.zig");
const std = @import("std");
const CommandTag = @import("./CommandTag.zig").CommandTag;
const PostgresSQLQueryResultMode = @import("../shared/SQLQueryResultMode.zig").SQLQueryResultMode;

const AnyPostgresError = @import("./AnyPostgresError.zig").AnyPostgresError;
const postgresErrorToJS = @import("./AnyPostgresError.zig").postgresErrorToJS;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSRef = jsc.JSRef;
const JSValue = jsc.JSValue;
