const JSMySQLQuery = @This();
const RefCount = bun.ptr.RefCount(@This(), "__ref_count", deinit, .{});

#thisValue: JSRef = JSRef.empty(),
// unfortunally we cannot use #ref_count here
__ref_count: RefCount = RefCount.init(),
#vm: *jsc.VirtualMachine,
#globalObject: *jsc.JSGlobalObject,
#query: MySQLQuery,

pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub fn estimatedSize(this: *@This()) usize {
    _ = this;
    return @sizeOf(@This());
}

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*@This() {
    _ = callframe;
    return globalThis.throwInvalidArguments("MySQLQuery cannot be constructed directly", .{});
}

fn deinit(this: *@This()) void {
    this.#query.cleanup();
    bun.destroy(this);
}

pub fn finalize(this: *@This()) void {
    debug("MySQLQuery finalize", .{});

    this.#thisValue.finalize();
    this.deref();
}

pub fn createInstance(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
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

    var this = bun.new(@This(), .{
        .#query = MySQLQuery.init(
            try query.toBunString(globalThis),
            bigint,
            simple,
        ),
        .#globalObject = globalThis,
        .#vm = globalThis.bunVM(),
    });

    const this_value = this.toJS(globalThis);
    this_value.ensureStillAlive();
    this.#thisValue.setWeak(this_value);

    this.setBinding(values);
    this.setPendingValue(pending_value);
    if (!columns.isUndefined()) {
        this.setColumns(columns);
    }

    return this_value;
}

pub fn doRun(this: *@This(), globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    debug("doRun", .{});
    this.ref();
    defer this.deref();

    var arguments = callframe.arguments();
    if (arguments.len < 2) {
        return globalObject.throwInvalidArguments("run must be called with 2 arguments connection and target", .{});
    }
    const connection: *MySQLConnection = arguments[0].as(MySQLConnection) orelse {
        return globalObject.throw("connection must be a MySQLConnection", .{});
    };
    var target = arguments[1];
    if (!target.isObject()) {
        return globalObject.throwInvalidArgumentType("run", "query", "Query");
    }
    this.setTarget(target);
    this.run(connection) catch |err| {
        if (!globalObject.hasException()) {
            return globalObject.throwValue(AnyMySQLError.mysqlErrorToJS(globalObject, "failed to execute query", err));
        }
        return error.JSError;
    };
    connection.enqueueRequest(this);
    return .js_undefined;
}
pub fn doCancel(_: *@This(), _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    // TODO: we can cancel a query that is pending aka not pipelined yet we just need fail it
    // if is running is not worth/viable to cancel the whole connection
    return .js_undefined;
}

pub fn doDone(_: *@This(), _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    // TODO: investigate why this function is needed
    return .js_undefined;
}

pub fn setModeFromJS(this: *@This(), globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const js_mode = callframe.argument(0);
    if (js_mode.isEmptyOrUndefinedOrNull() or !js_mode.isNumber()) {
        return globalObject.throwInvalidArgumentType("setMode", "mode", "Number");
    }

    const mode_value = try js_mode.coerce(i32, globalObject);
    const mode = std.meta.intToEnum(SQLQueryResultMode, mode_value) catch {
        return globalObject.throwInvalidArgumentTypeValue("mode", "Number", js_mode);
    };
    this.#query.setResultMode(mode);
    return .js_undefined;
}

pub fn setPendingValueFromJS(this: *@This(), _: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const result = callframe.argument(0);
    this.setPendingValue(result);
    return .js_undefined;
}

pub fn resolve(
    this: *@This(),
    queries_array: JSValue,
    result: MySQLQueryResult,
) void {
    this.ref();
    const is_last_result = result.is_last_result;
    defer {
        if (this.#thisValue.isNotEmpty() and is_last_result) {
            this.#thisValue.downgrade();
        }
        this.deref();
    }

    if (!this.#query.result(is_last_result)) {
        return;
    }
    if (this.#vm.isShuttingDown()) {
        return;
    }

    const targetValue = this.getTarget() orelse return;
    const thisValue = this.#thisValue.tryGet() orelse return;
    thisValue.ensureStillAlive();
    const tag: CommandTag = .{ .SELECT = result.result_count };
    const js_tag = tag.toJSTag(this.#globalObject) catch return bun.assertf(false, "in MySQLQuery Tag should always be a number", .{});
    js_tag.ensureStillAlive();

    const function = this.#vm.rareData().mysql_context.onQueryResolveFn.get() orelse return;
    bun.assertf(function.isCallable(), "onQueryResolveFn is not callable", .{});

    const event_loop = this.#vm.eventLoop();

    const pending_value = this.getPendingValue() orelse .js_undefined;
    pending_value.ensureStillAlive();
    this.setPendingValue(.js_undefined);

    event_loop.runCallback(function, this.#globalObject, thisValue, &.{
        targetValue,
        pending_value,
        js_tag,
        tag.toJSNumber(),
        if (queries_array == .zero) .js_undefined else queries_array,
        JSValue.jsBoolean(is_last_result),
        JSValue.jsNumber(result.last_insert_id),
        JSValue.jsNumber(result.affected_rows),
    });
}

pub fn markAsFailed(this: *@This()) void {
    // Attention: we cannot touch JS here
    // If you need to touch JS, you wanna to use reject or rejectWithJSValue instead
    this.ref();
    defer this.deref();
    if (this.#thisValue.isNotEmpty()) {
        this.#thisValue.downgrade();
    }
    _ = this.#query.fail();
}

pub fn reject(this: *@This(), queries_array: JSValue, err: AnyMySQLError.Error) void {
    if (this.#vm.isShuttingDown()) {
        this.markAsFailed();
        return;
    }
    if (this.#globalObject.tryTakeException()) |err_| {
        this.rejectWithJSValue(queries_array, err_);
    } else {
        const instance = AnyMySQLError.mysqlErrorToJS(this.#globalObject, "Failed to bind query", err);
        instance.ensureStillAlive();
        this.rejectWithJSValue(queries_array, instance);
    }
}

pub fn rejectWithJSValue(this: *@This(), queries_array: JSValue, err: JSValue) void {
    this.ref();

    defer {
        if (this.#thisValue.isNotEmpty()) {
            this.#thisValue.downgrade();
        }
        this.deref();
    }
    if (!this.#query.fail()) {
        return;
    }

    if (this.#vm.isShuttingDown()) {
        return;
    }
    const targetValue = this.getTarget() orelse return;

    var js_error = err.toError() orelse err;
    if (js_error == .zero) {
        js_error = AnyMySQLError.mysqlErrorToJS(this.#globalObject, "Query failed", error.UnknownError);
    }
    bun.assertf(js_error != .zero, "js_error is zero", .{});
    js_error.ensureStillAlive();
    const function = this.#vm.rareData().mysql_context.onQueryRejectFn.get() orelse return;
    bun.assertf(function.isCallable(), "onQueryRejectFn is not callable", .{});
    const event_loop = this.#vm.eventLoop();
    const js_array = if (queries_array == .zero) .js_undefined else queries_array;
    js_array.ensureStillAlive();
    event_loop.runCallback(function, this.#globalObject, this.#thisValue.tryGet() orelse return, &.{
        targetValue,
        js_error,
        js_array,
    });
}

pub fn run(this: *@This(), connection: *MySQLConnection) AnyMySQLError.Error!void {
    if (this.#vm.isShuttingDown()) {
        debug("run cannot run a query if the VM is shutting down", .{});
        // cannot run a query if the VM is shutting down
        return;
    }
    if (!this.#query.isPending() or this.#query.isBeingPrepared()) {
        debug("run already running or being prepared", .{});
        // already running or completed
        return;
    }
    const globalObject = this.#globalObject;
    this.#thisValue.upgrade(globalObject);
    errdefer {
        this.#thisValue.downgrade();
        _ = this.#query.fail();
    }

    const columns_value = this.getColumns() orelse .js_undefined;
    const binding_value = this.getBinding() orelse .js_undefined;
    this.#query.runQuery(connection, globalObject, columns_value, binding_value) catch |err| {
        debug("run failed to execute query", .{});
        if (!globalObject.hasException())
            return globalObject.throwValue(AnyMySQLError.mysqlErrorToJS(globalObject, "failed to execute query", err));
        return error.JSError;
    };
}
pub inline fn isCompleted(this: *@This()) bool {
    return this.#query.isCompleted();
}
pub inline fn isRunning(this: *@This()) bool {
    return this.#query.isRunning();
}
pub inline fn isPending(this: *@This()) bool {
    return this.#query.isPending();
}
pub inline fn isBeingPrepared(this: *@This()) bool {
    return this.#query.isBeingPrepared();
}
pub inline fn isPipelined(this: *@This()) bool {
    return this.#query.isPipelined();
}
pub inline fn isSimple(this: *@This()) bool {
    return this.#query.isSimple();
}
pub inline fn isBigintSupported(this: *@This()) bool {
    return this.#query.isBigintSupported();
}
pub inline fn getResultMode(this: *@This()) SQLQueryResultMode {
    return this.#query.getResultMode();
}
// TODO: isolate statement modification away from the connection
pub fn getStatement(this: *@This()) ?*MySQLStatement {
    return this.#query.getStatement();
}

pub fn markAsPrepared(this: *@This()) void {
    this.#query.markAsPrepared();
}

pub inline fn setPendingValue(this: *@This(), result: JSValue) void {
    if (this.#vm.isShuttingDown()) return;
    if (this.#thisValue.tryGet()) |value| {
        js.pendingValueSetCached(value, this.#globalObject, result);
    }
}
pub inline fn getPendingValue(this: *@This()) ?JSValue {
    if (this.#vm.isShuttingDown()) return null;
    if (this.#thisValue.tryGet()) |value| {
        return js.pendingValueGetCached(value);
    }
    return null;
}

inline fn setTarget(this: *@This(), result: JSValue) void {
    if (this.#vm.isShuttingDown()) return;
    if (this.#thisValue.tryGet()) |value| {
        js.targetSetCached(value, this.#globalObject, result);
    }
}
inline fn getTarget(this: *@This()) ?JSValue {
    if (this.#vm.isShuttingDown()) return null;
    if (this.#thisValue.tryGet()) |value| {
        return js.targetGetCached(value);
    }
    return null;
}

inline fn setColumns(this: *@This(), result: JSValue) void {
    if (this.#vm.isShuttingDown()) return;
    if (this.#thisValue.tryGet()) |value| {
        js.columnsSetCached(value, this.#globalObject, result);
    }
}
inline fn getColumns(this: *@This()) ?JSValue {
    if (this.#vm.isShuttingDown()) return null;

    if (this.#thisValue.tryGet()) |value| {
        return js.columnsGetCached(value);
    }
    return null;
}
inline fn setBinding(this: *@This(), result: JSValue) void {
    if (this.#vm.isShuttingDown()) return;
    if (this.#thisValue.tryGet()) |value| {
        js.bindingSetCached(value, this.#globalObject, result);
    }
}
inline fn getBinding(this: *@This()) ?JSValue {
    if (this.#vm.isShuttingDown()) return null;
    if (this.#thisValue.tryGet()) |value| {
        return js.bindingGetCached(value);
    }
    return null;
}
comptime {
    @export(&jsc.toJSHostFn(createInstance), .{ .name = "MySQLQuery__createInstance" });
}

pub const js = jsc.Codegen.JSMySQLQuery;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;

const debug = bun.Output.scoped(.MySQLQuery, .visible);

const AnyMySQLError = @import("../protocol/AnyMySQLError.zig");
const MySQLConnection = @import("./JSMySQLConnection.zig");
const MySQLQuery = @import("../MySQLQuery.zig");
const MySQLQueryResult = @import("../MySQLQueryResult.zig");
const MySQLStatement = @import("../MySQLStatement.zig");
const bun = @import("bun");
const std = @import("std");
const CommandTag = @import("../../postgres/CommandTag.zig").CommandTag;
const SQLQueryResultMode = @import("../../shared/SQLQueryResultMode.zig").SQLQueryResultMode;

const jsc = bun.jsc;
const JSRef = jsc.JSRef;
const JSValue = jsc.JSValue;
