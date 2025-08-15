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
    written,
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
    err: anyerror,
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

    const instance = globalObject.createErrorInstance("Failed to bind query: {s}", .{@errorName(err)});

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

pub fn bindAndExecute(this: *MySQLQuery, writer: anytype, statement: *MySQLStatement, globalObject: *jsc.JSGlobalObject) !void {
    var execute = PreparedStatement.Execute{
        .statement_id = statement.statement_id,
        .param_types = statement.params,
        .iteration_count = 1,
    };
    defer execute.deinit();
    try this.bind(&execute, globalObject);
    try execute.write(writer);
    this.status = .written;
}

pub fn bind(this: *MySQLQuery, execute: *PreparedStatement.Execute, globalObject: *jsc.JSGlobalObject) !void {
    const thisValue = this.thisValue.get();
    const binding_value = js.bindingGetCached(thisValue) orelse .zero;
    const columns_value = js.columnsGetCached(thisValue) orelse .zero;

    var iter = try QueryBindingIterator.init(binding_value, columns_value, globalObject);

    var i: u32 = 0;
    var params = try bun.default_allocator.alloc(Data, execute.params.len);
    errdefer {
        for (params[0..i]) |*param| {
            param.deinit();
        }
        bun.default_allocator.free(params);
    }
    while (try iter.next()) |js_value| {
        const param = execute.param_types[i];
        var value = try Value.fromJS(
            js_value,
            globalObject,
            param,
            // TODO: unsigned
            false,
        );
        defer value.deinit(bun.default_allocator);
        params[i] = try value.toData(param);
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
    const function = vm.rareData().postgresql_context.onQueryRejectFn.get().?;
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

pub fn onResult(this: *@This(), command_tag_str: []const u8, globalObject: *jsc.JSGlobalObject, connection: jsc.JSValue, is_last: bool) void {
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
    const function = vm.rareData().postgresql_context.onQueryResolveFn.get().?;
    const event_loop = vm.eventLoop();
    const tag = CommandTag.init(command_tag_str);

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

    const columns_value = js.columnsGetCached(callframe.this()) orelse .js_undefined;

    var signature = Signature.generate(globalObject, query_str.slice(), binding_value, columns_value) catch |err| {
        this.deref();
        if (!globalObject.hasException())
            return globalObject.throwError(err, "failed to generate signature");
        return error.JSError;
    };
    errdefer signature.deinit();

    const entry = connection.statements.getOrPut(bun.default_allocator, bun.hash(signature.name)) catch |err| {
        this.deref();
        return globalObject.throwError(err, "failed to allocate statement");
    };

    const has_params = signature.fields.len > 0;
    var did_write = false;

    enqueue: {
        if (entry.found_existing) {
            this.statement = entry.value_ptr.*;
            this.statement.?.ref();
            signature.deinit();
            signature = Signature{};

            if (has_params and this.statement.?.status == .parsing) {
                // if it has params, we need to wait for PrepareOk to be received before we can write the data
            } else {
                this.flags.binary = true;
                debug("doRun: binding and executing query", .{});
                this.bindAndExecute(writer, this.statement.?, globalObject) catch |err| {
                    if (!globalObject.hasException())
                        return globalObject.throwError(err, "failed to bind and execute query");
                    return error.JSError;
                };
                did_write = true;
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
            .status = .parsing,
            .statement_id = 0,
        };
        this.statement = stmt;
        entry.value_ptr.* = stmt;
    }

    this.status = if (did_write) .binding else .pending;
    try connection.requests.writeItem(this);
    debug("doRun: wrote query to connection", .{});
    this.thisValue.upgrade(globalObject);

    js.targetSetCached(this_value, globalObject, query);
    if (did_write) {
        connection.flushDataAndResetTimeout();
    } else {
        connection.resetConnectionTimeout();
    }

    return .js_undefined;
}

comptime {
    @export(&jsc.toJSHostFn(call), .{ .name = "MySQLQuery__createInstance" });
}

pub const js = jsc.Codegen.JSMySQLQuery;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;

const std = @import("std");
const bun = @import("bun");
const MySQLStatement = @import("./MySQLStatement.zig");
const MySQLConnection = @import("./MySQLConnection.zig");
const Signature = @import("./protocol/Signature.zig");
const Data = @import("./protocol/Data.zig").Data;
const Value = @import("./MySQLTypes.zig").Value;
const debug = bun.Output.scoped(.MySQLQuery, false);
const PreparedStatement = @import("./protocol/PreparedStatement.zig");
const QueryBindingIterator = @import("../shared/QueryBindingIterator.zig").QueryBindingIterator;
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ErrorPacket = @import("./protocol/ErrorPacket.zig");
const SQLQueryResultMode = @import("../shared/SQLQueryResultMode.zig").SQLQueryResultMode;
const JSRef = jsc.JSRef;
// TODO: move to shared IF POSSIBLE
const CommandTag = @import("../postgres/CommandTag.zig").CommandTag;
