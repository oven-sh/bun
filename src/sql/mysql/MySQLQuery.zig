const MySQLQuery = @This();

#statement: ?*MySQLStatement = null,
#query: bun.String,

#status: Status,
#flags: packed struct(u8) {
    bigint: bool = false,
    simple: bool = false,
    pipelined: bool = false,
    result_mode: SQLQueryResultMode = .objects,
    _padding: u3 = 0,
},

fn bind(this: *MySQLQuery, execute: *PreparedStatement.Execute, globalObject: *JSGlobalObject, binding_value: JSValue, columns_value: JSValue) AnyMySQLError.Error!void {
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

    this.#status = .binding;
    execute.params = params;
}

fn bindAndExecute(this: *MySQLQuery, writer: anytype, statement: *MySQLStatement, globalObject: *JSGlobalObject, binding_value: JSValue, columns_value: JSValue) AnyMySQLError.Error!void {
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
    try this.bind(&execute, globalObject, binding_value, columns_value);
    try execute.write(writer);
    try packet.end();
    this.#status = .running;
}

fn runSimpleQuery(this: *@This(), connection: *MySQLConnection) !void {
    if (this.#status != .pending or !connection.canExecuteQuery()) {
        debug("cannot execute query", .{});
        // cannot execute query
        return;
    }
    var query_str = this.#query.toUTF8(bun.default_allocator);
    defer query_str.deinit();
    const writer = connection.getWriter();
    if (this.#statement == null) {
        const stmt = bun.new(MySQLStatement, .{
            .signature = Signature.empty(),
            .status = .parsing,
            .ref_count = .initExactRefs(1),
        });
        this.#statement = stmt;
    }
    try MySQLRequest.executeQuery(query_str.slice(), MySQLConnection.Writer, writer);

    this.#status = .running;
}

fn runPreparedQuery(
    this: *@This(),
    connection: *MySQLConnection,
    globalObject: *JSGlobalObject,
    columns_value: JSValue,
    binding_value: JSValue,
) !void {
    var query_str: ?bun.ZigString.Slice = null;
    defer if (query_str) |str| str.deinit();

    if (this.#statement == null) {
        const query = this.#query.toUTF8(bun.default_allocator);
        query_str = query;
        var signature = Signature.generate(globalObject, query.slice(), binding_value, columns_value) catch |err| {
            if (!globalObject.hasException())
                return globalObject.throwValue(AnyMySQLError.mysqlErrorToJS(globalObject, "failed to generate signature", err));
            return error.JSError;
        };
        errdefer signature.deinit();
        const entry = connection.getStatementFromSignatureHash(bun.hash(signature.name)) catch |err| {
            return globalObject.throwError(err, "failed to allocate statement");
        };

        if (entry.found_existing) {
            const stmt = entry.value_ptr.*;
            if (stmt.status == .failed) {
                const error_response = stmt.error_response.toJS(globalObject);
                // If the statement failed, we need to throw the error
                return globalObject.throwValue(error_response);
            }
            this.#statement = stmt;
            stmt.ref();
            signature.deinit();
            signature = Signature{};
        } else {
            const stmt = bun.new(MySQLStatement, .{
                .signature = signature,
                .ref_count = .initExactRefs(2),
                .status = .pending,
                .statement_id = 0,
            });
            this.#statement = stmt;
            entry.value_ptr.* = stmt;
        }
    }
    const stmt = this.#statement.?;
    switch (stmt.status) {
        .failed => {
            debug("failed", .{});
            const error_response = stmt.error_response.toJS(globalObject);
            // If the statement failed, we need to throw the error
            return globalObject.throwValue(error_response);
        },
        .prepared => {
            if (connection.canPipeline()) {
                debug("bindAndExecute", .{});
                const writer = connection.getWriter();
                this.bindAndExecute(writer, stmt, globalObject, binding_value, columns_value) catch |err| {
                    if (!globalObject.hasException())
                        return globalObject.throwValue(AnyMySQLError.mysqlErrorToJS(globalObject, "failed to bind and execute query", err));
                    return error.JSError;
                };
                this.#flags.pipelined = true;
            }
        },
        .parsing => {
            debug("parsing", .{});
        },
        .pending => {
            if (connection.canPrepareQuery()) {
                debug("prepareRequest", .{});
                const writer = connection.getWriter();
                const query = query_str orelse this.#query.toUTF8(bun.default_allocator);
                MySQLRequest.prepareRequest(query.slice(), MySQLConnection.Writer, writer) catch |err| {
                    return globalObject.throwError(err, "failed to prepare query");
                };
                stmt.status = .parsing;
            }
        },
    }
}

pub fn init(query: bun.String, bigint: bool, simple: bool) @This() {
    query.ref();
    return .{
        .#query = query,
        .#status = .pending,
        .#flags = .{
            .bigint = bigint,
            .simple = simple,
        },
    };
}

pub fn runQuery(this: *@This(), connection: *MySQLConnection, globalObject: *JSGlobalObject, columns_value: JSValue, binding_value: JSValue) !void {
    if (this.#flags.simple) {
        debug("runSimpleQuery", .{});
        return try this.runSimpleQuery(connection);
    }
    debug("runPreparedQuery", .{});
    return try this.runPreparedQuery(
        connection,
        globalObject,
        if (columns_value == .zero) .js_undefined else columns_value,
        if (binding_value == .zero) .js_undefined else binding_value,
    );
}

pub inline fn setResultMode(this: *@This(), result_mode: SQLQueryResultMode) void {
    this.#flags.result_mode = result_mode;
}

pub inline fn result(this: *@This(), is_last_result: bool) bool {
    if (this.#status == .success or this.#status == .fail) return false;
    this.#status = if (is_last_result) .success else .partial_response;

    return true;
}
pub fn fail(this: *@This()) bool {
    if (this.#status == .fail or this.#status == .success) return false;
    this.#status = .fail;

    return true;
}

pub fn cleanup(this: *@This()) void {
    if (this.#statement) |statement| {
        statement.deref();
        this.#statement = null;
    }
    var query = this.#query;
    defer query.deref();
    this.#query = bun.String.empty;
}

pub inline fn isCompleted(this: *const @This()) bool {
    return this.#status == .success or this.#status == .fail;
}
pub inline fn isRunning(this: *const @This()) bool {
    switch (this.#status) {
        .running, .binding, .partial_response => return true,
        .success, .fail, .pending => return false,
    }
}
pub inline fn isPending(this: *const @This()) bool {
    return this.#status == .pending;
}

pub inline fn isBeingPrepared(this: *@This()) bool {
    return this.#status == .pending and this.#statement != null and this.#statement.?.status == .parsing;
}

pub inline fn isPipelined(this: *const @This()) bool {
    return this.#flags.pipelined;
}
pub inline fn isSimple(this: *const @This()) bool {
    return this.#flags.simple;
}
pub inline fn isBigintSupported(this: *const @This()) bool {
    return this.#flags.bigint;
}
pub inline fn getResultMode(this: *const @This()) SQLQueryResultMode {
    return this.#flags.result_mode;
}
pub inline fn markAsPrepared(this: *@This()) void {
    if (this.#status == .pending) {
        if (this.#statement) |statement| {
            if (statement.status == .parsing and
                statement.params.len == statement.params_received and
                statement.statement_id > 0)
            {
                statement.status = .prepared;
            }
        }
    }
}
pub inline fn getStatement(this: *const @This()) ?*MySQLStatement {
    return this.#statement;
}

const debug = bun.Output.scoped(.MySQLQuery, .visible);

const AnyMySQLError = @import("./protocol/AnyMySQLError.zig");
const MySQLConnection = @import("./js/JSMySQLConnection.zig");
const MySQLRequest = @import("./MySQLRequest.zig");
const MySQLStatement = @import("./MySQLStatement.zig");
const PreparedStatement = @import("./protocol/PreparedStatement.zig");
const Signature = @import("./protocol/Signature.zig");
const bun = @import("bun");
const QueryBindingIterator = @import("../shared/QueryBindingIterator.zig").QueryBindingIterator;
const SQLQueryResultMode = @import("../shared/SQLQueryResultMode.zig").SQLQueryResultMode;
const Status = @import("./QueryStatus.zig").Status;
const Value = @import("./MySQLTypes.zig").Value;

const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
