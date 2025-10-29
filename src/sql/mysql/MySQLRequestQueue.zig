pub const MySQLRequestQueue = @This();

#requests: Queue,

#pipelined_requests: u32 = 0,
#nonpipelinable_requests: u32 = 0,
// TODO: refactor to ENUM
#waiting_to_prepare: bool = false,
#is_ready_for_query: bool = true,

pub inline fn canExecuteQuery(this: *const @This(), connection: *const MySQLConnection) bool {
    return connection.isAbleToWrite() and
        this.#is_ready_for_query and
        this.#nonpipelinable_requests == 0 and
        this.#pipelined_requests == 0;
}
pub inline fn canPrepareQuery(this: *const @This(), connection: *const MySQLConnection) bool {
    return connection.isAbleToWrite() and
        this.#is_ready_for_query and
        !this.#waiting_to_prepare and
        this.#pipelined_requests == 0;
}

pub inline fn markAsReadyForQuery(this: *@This()) void {
    this.#is_ready_for_query = true;
}
pub inline fn markAsPrepared(this: *@This()) void {
    this.#waiting_to_prepare = false;
    if (this.current()) |request| {
        debug("markAsPrepared markAsPrepared", .{});
        request.markAsPrepared();
    }
}
pub inline fn canPipeline(this: *@This(), connection: *MySQLConnection) bool {
    if (bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING.get()) {
        @branchHint(.unlikely);
        return false;
    }

    return this.#is_ready_for_query and
        this.#nonpipelinable_requests == 0 and // need to wait for non pipelinable requests to finish
        !this.#waiting_to_prepare and
        connection.isAbleToWrite();
}

pub fn markCurrentRequestAsFinished(this: *@This(), item: *JSMySQLQuery) void {
    this.#waiting_to_prepare = false;
    if (item.isBeingPrepared()) {
        debug("markCurrentRequestAsFinished markAsPrepared", .{});
        item.markAsPrepared();
    } else if (item.isRunning()) {
        if (item.isPipelined()) {
            this.#pipelined_requests -= 1;
        } else {
            this.#nonpipelinable_requests -= 1;
        }
    }
}

pub fn advance(this: *@This(), connection: *MySQLConnection) void {
    var offset: usize = 0;
    defer {
        while (this.#requests.readableLength() > 0) {
            const request = this.#requests.peekItem(0);
            // An item may be in the success or failed state and still be inside the queue (see deinit later comments)
            // so we do the cleanup her
            if (request.isCompleted()) {
                debug("isCompleted discard after advance", .{});
                this.#requests.discard(1);
                request.deref();
                continue;
            }
            break;
        }
    }

    while (this.#requests.readableLength() > offset and connection.isAbleToWrite()) {
        var request: *JSMySQLQuery = this.#requests.peekItem(offset);

        if (request.isCompleted()) {
            if (offset > 0) {
                // discard later
                offset += 1;
                continue;
            }
            debug("isCompleted", .{});
            this.#requests.discard(1);
            request.deref();
            continue;
        }

        if (request.isBeingPrepared()) {
            debug("isBeingPrepared", .{});
            this.#waiting_to_prepare = true;
            // cannot continue the queue until the current request is marked as prepared
            return;
        }
        if (request.isRunning()) {
            debug("isRunning", .{});
            const total_requests_running = this.#pipelined_requests + this.#nonpipelinable_requests;
            if (offset < total_requests_running) {
                offset += total_requests_running;
            } else {
                offset += 1;
            }
            continue;
        }

        request.run(connection) catch |err| {
            debug("run failed", .{});
            connection.onError(request, err);
            if (offset == 0) {
                this.#requests.discard(1);
                request.deref();
            }
            offset += 1;
            continue;
        };
        if (request.isBeingPrepared()) {
            debug("isBeingPrepared", .{});
            connection.resetConnectionTimeout();
            this.#is_ready_for_query = false;
            this.#waiting_to_prepare = true;
            return;
        } else if (request.isRunning()) {
            connection.resetConnectionTimeout();
            debug("isRunning after run", .{});
            this.#is_ready_for_query = false;

            if (request.isPipelined()) {
                this.#pipelined_requests += 1;
                if (this.canPipeline(connection)) {
                    debug("pipelined requests", .{});
                    offset += 1;
                    continue;
                }
                return;
            }
            debug("nonpipelinable requests", .{});
            this.#nonpipelinable_requests += 1;
        }
        return;
    }
}

pub fn init() @This() {
    return .{ .#requests = Queue.init(bun.default_allocator) };
}

pub fn isEmpty(this: *@This()) bool {
    return this.#requests.readableLength() == 0;
}

pub fn add(this: *@This(), request: *JSMySQLQuery) void {
    debug("add", .{});
    if (request.isBeingPrepared()) {
        this.#is_ready_for_query = false;
        this.#waiting_to_prepare = true;
    } else if (request.isRunning()) {
        this.#is_ready_for_query = false;

        if (request.isPipelined()) {
            this.#pipelined_requests += 1;
        } else {
            this.#nonpipelinable_requests += 1;
        }
    }
    request.ref();
    bun.handleOom(this.#requests.writeItem(request));
}

pub inline fn current(this: *const @This()) ?*JSMySQLQuery {
    if (this.#requests.readableLength() == 0) {
        return null;
    }

    return this.#requests.peekItem(0);
}

pub fn clean(this: *@This(), reason: ?JSValue, queries_array: JSValue) void {
    while (this.current()) |request| {
        if (request.isCompleted()) {
            request.deref();
            this.#requests.discard(1);
            continue;
        }
        if (reason) |r| {
            request.rejectWithJSValue(queries_array, r);
        } else {
            request.reject(queries_array, error.ConnectionClosed);
        }
        this.#requests.discard(1);
        request.deref();
        continue;
    }
    this.#pipelined_requests = 0;
    this.#nonpipelinable_requests = 0;
    this.#waiting_to_prepare = false;
}

pub fn deinit(this: *@This()) void {
    for (this.#requests.readableSlice(0)) |request| {
        this.#requests.discard(1);
        // We cannot touch JS here
        request.markAsFailed();
        request.deref();
    }
    this.#pipelined_requests = 0;
    this.#nonpipelinable_requests = 0;
    this.#waiting_to_prepare = false;
    this.#requests.deinit();
}

const Queue = bun.LinearFifo(*JSMySQLQuery, .Dynamic);

const debug = bun.Output.scoped(.MySQLRequestQueue, .visible);

const JSMySQLQuery = @import("./js/JSMySQLQuery.zig");
const MySQLConnection = @import("./js/JSMySQLConnection.zig");
const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
