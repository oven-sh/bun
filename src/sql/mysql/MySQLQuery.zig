const MySQLQuery = @This();
const RefCount = bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{});

statement: ?*MySQLStatement = null,
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
    result_mode: SQLQueryResultMode = .objects,
    _padding: u1 = 0,
} = .{},

pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

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
    debug("MySQLQuery finalize", .{});

    // Clean up any statement reference
    if (this.statement) |statement| {
        statement.deref();
        this.statement = null;
    }

    if (this.thisValue == .weak) {
        // clean up if is a weak reference, if is a strong reference we need to wait until the query is done
        // if we are a strong reference, here is probably a bug because GC'd should not happen
        this.thisValue.weak = .zero;
    }
    this.deref();
}

pub fn onWriteFail(
    this: *@This(),
    err: AnyMySQLError.Error,
    globalObject: *jsc.JSGlobalObject,
    queries_array: JSValue,
) void {
    this.status = .fail;
    const thisValue = this.thisValue.get();
    defer this.thisValue.deinit();
    const targetValue = this.getTarget(globalObject, true);
    if (thisValue == .zero or targetValue == .zero) {
        return;
    }

    const instance = AnyMySQLError.mysqlErrorToJS(globalObject, "Failed to bind query", err);

    const vm = jsc.VirtualMachine.get();
    const function = vm.rareData().mysql_context.onQueryRejectFn.get().?;
    const event_loop = vm.eventLoop();
    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        // TODO: add mysql error to JS
        // postgresErrorToJS(globalObject, null, err),
        instance,
        queries_array,
    });
}

pub fn bindAndExecute(this: *MySQLQuery, writer: anytype, statement: *MySQLStatement, globalObject: *jsc.JSGlobalObject) AnyMySQLError.Error!void {
    debug("bindAndExecute", .{});
    bun.assertf(statement.params.len == statement.params_received and statement.statement_id > 0, "statement is not prepared", .{});
    if (statement.signature.fields.len != statement.params.len) {
        return error.WrongNumberOfParametersProvided;
    }
    var packet = try writer.start(0);
    var execute = PreparedStatement.Execute{
        .statement_id = statement.statement_id,
        .param_types = statement.signature.fields,
        .new_params_bind_flag = statement.execution_flags.need_to_send_params,
        .iteration_count = 1,
    };
    statement.execution_flags.need_to_send_params = false;
    defer execute.deinit();
    try this.bind(&execute, globalObject);
    try execute.write(writer);
    try packet.end();
    this.status = .running;
}

fn bind(this: *MySQLQuery, execute: *PreparedStatement.Execute, globalObject: *jsc.JSGlobalObject) AnyMySQLError.Error!void {
    const thisValue = this.thisValue.get();
    const binding_value = js.bindingGetCached(thisValue) orelse .zero;
    const columns_value = js.columnsGetCached(thisValue) orelse .zero;

    var iter = try QueryBindingIterator.init(binding_value, columns_value, globalObject);

    var i: u32 = 0;
    var params = try bun.default_allocator.alloc(Value, execute.param_types.len);
    errdefer {
        for (params[0..i]) |*param| {
            param.deinit(bun.default_allocator);
        }
        bun.default_allocator.free(params);
    }
    while (try iter.next()) |js_value| {
        const param = execute.param_types[i];
        debug("param: {s} unsigned? {}", .{ @tagName(param.type), param.flags.UNSIGNED });
        params[i] = try Value.fromJS(
            js_value,
            globalObject,
            param.type,
            param.flags.UNSIGNED,
        );
        i += 1;
    }

    if (iter.anyFailed()) {
        return error.InvalidQueryBinding;
    }

    this.status = .binding;
    execute.params = params;
}

pub fn onError(this: *@This(), err: ErrorPacket, globalObject: *jsc.JSGlobalObject) void {
    debug("onError", .{});
    this.onJSError(err.toJS(globalObject), globalObject);
}

pub fn onJSError(this: *@This(), err: jsc.JSValue, globalObject: *jsc.JSGlobalObject) void {
    this.ref();
    defer this.deref();
    this.status = .fail;
    const thisValue = this.thisValue.get();
    defer this.thisValue.deinit();
    const targetValue = this.getTarget(globalObject, true);
    if (thisValue == .zero or targetValue == .zero) {
        return;
    }

    var vm = jsc.VirtualMachine.get();
    const function = vm.rareData().mysql_context.onQueryRejectFn.get().?;
    const event_loop = vm.eventLoop();
    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        err,
    });
}
pub fn getTarget(this: *@This(), globalObject: *jsc.JSGlobalObject, clean_target: bool) jsc.JSValue {
    const thisValue = this.thisValue.tryGet() orelse return .zero;
    const target = js.targetGetCached(thisValue) orelse return .zero;
    if (clean_target) {
        js.targetSetCached(thisValue, globalObject, .zero);
    }
    return target;
}

fn consumePendingValue(thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject) ?JSValue {
    const pending_value = js.pendingValueGetCached(thisValue) orelse return null;
    js.pendingValueSetCached(thisValue, globalObject, .zero);
    return pending_value;
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

pub fn onResult(this: *@This(), result_count: u64, globalObject: *jsc.JSGlobalObject, connection: jsc.JSValue, is_last: bool) void {
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

    const vm = jsc.VirtualMachine.get();
    const function = vm.rareData().mysql_context.onQueryResolveFn.get().?;
    const event_loop = vm.eventLoop();
    const tag: CommandTag = .{ .SELECT = result_count };

    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        consumePendingValue(thisValue, globalObject) orelse .js_undefined,
        tag.toJSTag(globalObject),
        tag.toJSNumber(),
        if (connection == .zero) .js_undefined else MySQLConnection.js.queriesGetCached(connection) orelse .js_undefined,
        JSValue.jsBoolean(is_last),
    });
}

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*MySQLQuery {
    _ = callframe;
    return globalThis.throw("MySQLQuery cannot be constructed directly", .{});
}

pub fn estimatedSize(this: *MySQLQuery) usize {
    _ = this;
    return @sizeOf(MySQLQuery);
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

    var ptr = bun.default_allocator.create(MySQLQuery) catch |err| {
        return globalThis.throwError(err, "failed to allocate query");
    };

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
    ptr.query.ref();

    js.bindingSetCached(this_value, globalThis, values);
    js.pendingValueSetCached(this_value, globalThis, pending_value);
    if (!columns.isUndefined()) {
        js.columnsSetCached(this_value, globalThis, columns);
    }

    return this_value;
}
pub fn setPendingValue(this: *@This(), globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const result = callframe.argument(0);
    const thisValue = this.thisValue.tryGet() orelse return .js_undefined;
    js.pendingValueSetCached(thisValue, globalObject, result);
    return .js_undefined;
}
pub fn setMode(this: *@This(), globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const js_mode = callframe.argument(0);
    if (js_mode.isEmptyOrUndefinedOrNull() or !js_mode.isNumber()) {
        return globalObject.throwInvalidArgumentType("setMode", "mode", "Number");
    }

    const mode = try js_mode.coerce(i32, globalObject);
    this.flags.result_mode = std.meta.intToEnum(SQLQueryResultMode, mode) catch {
        return globalObject.throwInvalidArgumentTypeValue("mode", "Number", js_mode);
    };
    return .js_undefined;
}

pub fn doDone(this: *@This(), globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    _ = globalObject;
    this.flags.is_done = true;
    return .js_undefined;
}

pub fn doCancel(this: *MySQLQuery, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    _ = callframe;
    _ = globalObject;
    _ = this;

    return .js_undefined;
}

pub fn doRun(this: *MySQLQuery, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    debug("doRun", .{});
    var arguments = callframe.arguments();
    const connection: *MySQLConnection = arguments[0].as(MySQLConnection) orelse {
        return globalObject.throw("connection must be a MySQLConnection", .{});
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
    const writer = connection.writer();
    // We need a strong reference to the query so that it doesn't get GC'd
    this.ref();
    const can_execute = connection.canExecuteQuery();
    if (this.flags.simple) {
        // simple queries are always text in MySQL
        this.flags.binary = false;
        debug("executeQuery", .{});

        const stmt = bun.default_allocator.create(MySQLStatement) catch {
            this.deref();
            return globalObject.throwOutOfMemory();
        };
        // Query is simple and it's the only owner of the statement
        stmt.* = .{
            .signature = Signature.empty(),
            .status = .parsing,
        };
        this.statement = stmt;

        if (can_execute) {
            connection.sequence_id = 0;
            MySQLRequest.executeQuery(query_str.slice(), MySQLConnection.Writer, writer) catch |err| {
                debug("executeQuery failed: {s}", .{@errorName(err)});
                // fail to run do cleanup
                this.statement = null;
                bun.default_allocator.destroy(stmt);
                this.deref();

                if (!globalObject.hasException())
                    return globalObject.throwValue(AnyMySQLError.mysqlErrorToJS(globalObject, "failed to execute query", err));
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
        debug("doRun: wrote query to queue", .{});

        this.thisValue.upgrade(globalObject);
        js.targetSetCached(this_value, globalObject, query);
        connection.flushDataAndResetTimeout();
        return .js_undefined;
    }
    // prepared statements are always binary in MySQL
    this.flags.binary = true;

    const columns_value = js.columnsGetCached(callframe.this()) orelse .js_undefined;

    var signature = Signature.generate(globalObject, query_str.slice(), binding_value, columns_value) catch |err| {
        this.deref();
        if (!globalObject.hasException())
            return globalObject.throwValue(AnyMySQLError.mysqlErrorToJS(globalObject, "failed to generate signature", err));
        return error.JSError;
    };
    errdefer signature.deinit();

    const entry = connection.statements.getOrPut(bun.default_allocator, bun.hash(signature.name)) catch |err| {
        this.deref();
        return globalObject.throwError(err, "failed to allocate statement");
    };

    var did_write = false;

    enqueue: {
        if (entry.found_existing) {
            const stmt = entry.value_ptr.*;
            this.statement = stmt;
            stmt.ref();
            signature.deinit();
            signature = Signature{};
            switch (stmt.status) {
                .failed => {
                    this.statement = null;
                    const error_response = stmt.error_response.toJS(globalObject);
                    stmt.deref();
                    this.deref();
                    // If the statement failed, we need to throw the error
                    return globalObject.throwValue(error_response);
                },
                .prepared => {
                    if (can_execute or connection.canPipeline()) {
                        debug("doRun: binding and executing query", .{});
                        this.bindAndExecute(writer, this.statement.?, globalObject) catch |err| {
                            if (!globalObject.hasException())
                                return globalObject.throwValue(AnyMySQLError.mysqlErrorToJS(globalObject, "failed to bind and execute query", err));
                            return error.JSError;
                        };
                        connection.sequence_id = 0;
                        this.flags.pipelined = true;
                        connection.pipelined_requests += 1;
                        connection.flags.is_ready_for_query = false;
                        did_write = true;
                    }
                },

                .parsing, .pending => {},
            }

            break :enqueue;
        }

        const stmt = bun.default_allocator.create(MySQLStatement) catch |err| {
            this.deref();
            return globalObject.throwError(err, "failed to allocate statement");
        };
        stmt.* = .{
            .signature = signature,
            .ref_count = .initExactRefs(2),
            .status = .pending,
            .statement_id = 0,
        };
        this.statement = stmt;
        entry.value_ptr.* = stmt;
    }

    this.status = if (did_write) .running else .pending;
    try connection.requests.writeItem(this);
    this.thisValue.upgrade(globalObject);

    js.targetSetCached(this_value, globalObject, query);
    if (!did_write and can_execute) {
        debug("doRun: preparing query", .{});
        if (connection.canPrepareQuery()) {
            this.statement.?.status = .parsing;
            MySQLRequest.prepareRequest(query_str.slice(), MySQLConnection.Writer, writer) catch |err| {
                this.deref();
                return globalObject.throwError(err, "failed to prepare query");
            };
            connection.flags.waiting_to_prepare = true;
            connection.flags.is_ready_for_query = false;
        }
    }
    connection.flushDataAndResetTimeout();

    return .js_undefined;
}

comptime {
    @export(&jsc.toJSHostFn(call), .{ .name = "MySQLQuery__createInstance" });
}

pub const js = jsc.Codegen.JSMySQLQuery;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;

const debug = bun.Output.scoped(.MySQLQuery, .visible);
// TODO: move to shared IF POSSIBLE

const AnyMySQLError = @import("./protocol/AnyMySQLError.zig");
const ErrorPacket = @import("./protocol/ErrorPacket.zig");
const MySQLConnection = @import("./MySQLConnection.zig");
const MySQLRequest = @import("./MySQLRequest.zig");
const MySQLStatement = @import("./MySQLStatement.zig");
const PreparedStatement = @import("./protocol/PreparedStatement.zig");
const Signature = @import("./protocol/Signature.zig");
const bun = @import("bun");
const std = @import("std");
const CommandTag = @import("../postgres/CommandTag.zig").CommandTag;
const QueryBindingIterator = @import("../shared/QueryBindingIterator.zig").QueryBindingIterator;
const SQLQueryResultMode = @import("../shared/SQLQueryResultMode.zig").SQLQueryResultMode;
const Value = @import("./MySQLTypes.zig").Value;

const jsc = bun.jsc;
const JSRef = jsc.JSRef;
const JSValue = jsc.JSValue;
