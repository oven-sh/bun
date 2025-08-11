const MySQLQuery = @This();
statement: ?*MySQLStatement = null,
query: bun.String = bun.String.empty,
cursor_name: bun.String = bun.String.empty,
thisValue: JSValue = .js_undefined,
target: jsc.Strong.Optional = .empty,
status: Status = Status.pending,
is_done: bool = false,
ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),
binary: bool = false,
pending_value: jsc.Strong = .{},

pub const Status = enum(u8) {
    pending,
    written,
    running,
    binding,
    success,
    fail,

    pub fn isRunning(this: Status) bool {
        return this == .running or this == .binding;
    }
};

pub fn hasPendingActivity(this: *@This()) bool {
    return this.ref_count.load(.monotonic) > 1;
}

pub fn deinit(this: *@This()) void {
    if (this.statement) |statement| {
        statement.deref();
    }
    this.query.deref();
    this.cursor_name.deref();
    this.target.deinit();
    this.pending_value.deinit();

    bun.default_allocator.destroy(this);
}

pub fn finalize(this: *@This()) void {
    debug("MySQLQuery finalize", .{});

    // Clean up any statement reference
    if (this.statement) |statement| {
        statement.deref();
        this.statement = null;
    }

    this.thisValue = .zero;
    this.deref();
}

pub fn onNoData(this: *@This(), globalObject: *jsc.JSGlobalObject) void {
    this.status = .success;
    defer this.deref();

    const thisValue = this.thisValue;
    const targetValue = this.target.trySwap() orelse JSValue.zero;
    if (thisValue == .zero or targetValue == .zero) {
        return;
    }

    const vm = jsc.VirtualMachine.get();
    const function = vm.rareData().mysql_context.onQueryResolveFn.get().?;
    const event_loop = vm.eventLoop();
    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        this.pending_value.trySwap() orelse .undefined,
        JSValue.jsNumber(0),
        JSValue.jsNumber(0),
    });
}

pub fn onWriteFail(this: *@This(), err: anyerror, globalObject: *jsc.JSGlobalObject) void {
    this.status = .fail;
    this.pending_value.deinit();
    const thisValue = this.thisValue;
    const targetValue = this.target.trySwap() orelse JSValue.zero;
    if (thisValue == .zero or targetValue == .zero) {
        return;
    }

    const instance = globalObject.createErrorInstance("Failed to bind query: {s}", .{@errorName(err)});

    const vm = jsc.VirtualMachine.get();
    const function = vm.rareData().mysql_context.onQueryRejectFn.get().?;
    const event_loop = vm.eventLoop();
    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        instance,
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
    const binding_value = MySQLQuery.bindingGetCached(this.thisValue) orelse .zero;
    const columns_value = MySQLQuery.columnsGetCached(this.thisValue) orelse .zero;

    var iter = QueryBindingIterator.init(binding_value, columns_value, globalObject);

    var i: u32 = 0;
    var params = try bun.default_allocator.alloc(Data, execute.params.len);
    errdefer {
        for (params[0..i]) |*param| {
            param.deinit();
        }
        bun.default_allocator.free(params);
    }
    while (iter.next()) |js_value| {
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
    this.status = .fail;
    defer {
        // Clean up statement reference on error
        if (this.statement) |statement| {
            statement.deref();
            this.statement = null;
        }
        this.deref();
    }

    const thisValue = this.thisValue;
    const targetValue = this.target.trySwap() orelse JSValue.zero;
    if (thisValue == .zero or targetValue == .zero) {
        return;
    }

    var vm = jsc.VirtualMachine.get();
    const function = vm.rareData().mysql_context.onQueryRejectFn.get().?;
    globalObject.queueMicrotask(function, &[_]JSValue{ targetValue, err.toJS(globalObject) });
}

pub fn onJSError(this: *@This(), exception: jsc.JSValue, globalObject: *jsc.JSGlobalObject) void {
    this.status = .fail;
    defer {
        // Clean up statement reference on error
        if (this.statement) |statement| {
            statement.deref();
            this.statement = null;
        }
        this.deref();
    }

    const thisValue = this.thisValue;
    const targetValue = this.target.trySwap() orelse JSValue.zero;
    if (thisValue == .zero or targetValue == .zero) {
        return;
    }

    var vm = jsc.VirtualMachine.get();
    const function = vm.rareData().mysql_context.onQueryRejectFn.get().?;
    globalObject.queueMicrotask(function, &[_]JSValue{ targetValue, exception.toError().? });
}

pub fn onSuccess(this: *@This(), globalObject: *jsc.JSGlobalObject) void {
    this.status = .success;
    defer this.deref();

    const thisValue = this.thisValue;
    const targetValue = this.target.trySwap() orelse JSValue.zero;
    if (thisValue == .zero or targetValue == .zero) {
        return;
    }

    const vm = jsc.VirtualMachine.get();
    const function = vm.rareData().mysql_context.onQueryResolveFn.get().?;
    const event_loop = vm.eventLoop();
    event_loop.runCallback(function, globalObject, thisValue, &.{
        targetValue,
        this.pending_value.trySwap() orelse .undefined,
        JSValue.jsNumber(0),
        JSValue.jsNumber(0),
    });
}

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*MySQLQuery {
    _ = callframe;
    return globalThis.throw2("MySQLQuery cannot be constructed directly", .{});
}

pub fn estimatedSize(this: *MySQLQuery) usize {
    _ = this;
    return @sizeOf(MySQLQuery);
}

pub fn call(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.argumentsUndef(4).slice();
    const query = arguments[0];
    const values = arguments[1];
    const columns = arguments[3];

    if (!query.isString()) {
        globalThis.throw("query must be a string", .{});
        return .zero;
    }

    if (values.jsType() != .Array) {
        globalThis.throw("values must be an array", .{});
        return .zero;
    }

    const pending_value = arguments[2];
    if (!pending_value.jsType().isArrayLike()) {
        globalThis.throwInvalidArgumentType("query", "pendingValue", "Array");
        return .zero;
    }

    var ptr = bun.default_allocator.create(MySQLQuery) catch |err| {
        return globalThis.throwError(err, "failed to allocate query");
    };

    const this_value = ptr.toJS(globalThis);
    this_value.ensureStillAlive();

    ptr.* = .{
        .query = query.toBunString(globalThis),
        .thisValue = this_value,
    };
    ptr.query.ref();

    MySQLQuery.bindingSetCached(this_value, globalThis, values);
    MySQLQuery.pendingValueSetCached(this_value, globalThis, pending_value);
    if (columns != .undefined) {
        MySQLQuery.columnsSetCached(this_value, globalThis, columns);
    }
    ptr.pending_value.set(globalThis, pending_value);

    return this_value;
}

pub fn doDone(this: *@This(), globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    _ = globalObject;
    this.is_done = true;
    return .undefined;
}

pub fn doCancel(this: *MySQLQuery, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    _ = callframe;
    _ = globalObject;
    _ = this;

    return .undefined;
}

pub fn doRun(this: *MySQLQuery, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    var arguments_ = callframe.arguments_old(2);
    const arguments = arguments_.slice();
    var connection: *MySQLConnection = arguments[0].as(MySQLConnection) orelse {
        globalObject.throw("connection must be a MySQLConnection", .{});
        return error.JSError;
    };
    var query = arguments[1];

    if (!query.isObject()) {
        globalObject.throwInvalidArgumentType("run", "query", "Query");
        return error.JSError;
    }

    this.target.set(globalObject, query);
    const binding_value = MySQLQuery.bindingGetCached(callframe.this()) orelse .zero;
    var query_str = this.query.toUTF8(bun.default_allocator);
    defer query_str.deinit();
    const columns_value = MySQLQuery.columnsGetCached(callframe.this()) orelse .undefined;

    var signature = Signature.generate(globalObject, query_str.slice(), binding_value, columns_value) catch |err| {
        if (!globalObject.hasException())
            return globalObject.throwError(err, "failed to generate signature");
        return error.JSError;
    };
    errdefer signature.deinit();

    const writer = connection.writer();

    const entry = connection.statements.getOrPut(bun.default_allocator, bun.hash(signature.name)) catch |err| {
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
                this.binary = true;
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
            return globalObject.throwError(err, "failed to allocate statement");
        };
        stmt.* = .{
            .signature = signature,
            .ref_count = 2,
            .status = .parsing,
            .statement_id = 0,
        };
        this.statement = stmt;
        entry.value_ptr.* = stmt;
    }

    try connection.requests.writeItem(this);
    this.ref();
    this.status = if (did_write) .binding else .pending;

    if (connection.is_ready_for_query)
        connection.flushData();

    return .undefined;
}

comptime {
    const jscall = jsc.toJSHostFunction(call);
    @export(jscall, .{ .name = "MySQLQuery__createInstance" });
}

const std = @import("std");
const bun = @import("bun");
const MySQLStatement = @import("./MySQLStatement.zig");
const MySQLConnection = @import("./MySQLConnection.zig");
const Signature = @import("./protocol/Signature.zig");
const Data = @import("./protocol/Data.zig").Data;
const Value = @import("./MySQLTypes.zig").Value;
const debug = bun.Output.scoped(.MySQLQuery, false);
const PreparedStatement = @import("./protocol/PreparedStatement.zig");
const QueryBindingIterator = @import("./protocol/QueryBindingIterator.zig");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ErrorPacket = @import("./protocol/ErrorPacket.zig");
