const log = bun.Output.scoped(.S3, .hidden);
pub const S3HttpDownloadStreamingTask = struct {
    pub const new = bun.TrivialNew(@This());

    http: bun.http.AsyncHTTP,
    vm: *jsc.VirtualMachine,
    sign_result: SignResult,
    headers: bun.http.Headers,
    callback_context: *anyopaque,
    // this transfers ownership from the chunk
    callback: *const fn (chunk: bun.MutableString, has_more: bool, err: ?S3Error, *anyopaque) void,
    has_schedule_callback: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    signal_store: bun.http.Signals.Store = .{},
    signals: bun.http.Signals = .{},
    poll_ref: bun.Async.KeepAlive = bun.Async.KeepAlive.init(),

    response_buffer: bun.MutableString = .{
        .allocator = bun.default_allocator,
        .list = .{
            .items = &.{},
            .capacity = 0,
        },
    },
    mutex: bun.Mutex = .{},
    reported_response_buffer: bun.MutableString = .{
        .allocator = bun.default_allocator,
        .list = .{
            .items = &.{},
            .capacity = 0,
        },
    },
    state: State.AtomicType = State.AtomicType.init(@bitCast(State{})),

    concurrent_task: jsc.ConcurrentTask = .{},
    range: ?[]const u8,
    proxy_url: []const u8,

    pub const State = packed struct(u64) {
        pub const AtomicType = std.atomic.Value(u64);
        status_code: u32 = 0,
        request_error: u16 = 0,
        has_more: bool = true,
        _reserved: u15 = 0,
    };

    pub fn getState(this: @This()) State {
        const state: State = @bitCast(this.state.load(.acquire));
        return state;
    }

    pub fn setState(this: *@This(), state: State) void {
        this.state.store(@bitCast(state), .monotonic);
    }

    pub fn deinit(this: *@This()) void {
        this.poll_ref.unref(this.vm);
        this.response_buffer.deinit();
        this.reported_response_buffer.deinit();
        this.headers.deinit();
        this.sign_result.deinit();
        this.http.clearData();
        if (this.range) |range| {
            bun.default_allocator.free(range);
        }
        if (this.proxy_url.len > 0) {
            bun.default_allocator.free(this.proxy_url);
        }
        bun.destroy(this);
    }

    fn reportProgress(this: *@This(), state: State) void {
        const has_more = state.has_more;
        var err: ?S3Error = null;
        var failed = false;

        const chunk = brk: {
            switch (state.status_code) {
                200, 204, 206 => {
                    failed = state.request_error != 0;
                },
                else => {
                    failed = true;
                },
            }
            if (failed) {
                if (!has_more) {
                    var has_body_code = false;
                    var has_body_message = false;

                    var code: []const u8 = "UnknownError";
                    var message: []const u8 = "an unexpected error has occurred";
                    if (state.request_error != 0) {
                        const req_err = @errorFromInt(state.request_error);
                        code = @errorName(req_err);
                        has_body_code = true;
                    } else {
                        const bytes = this.reported_response_buffer.list.items;
                        if (bytes.len > 0) {
                            message = bytes[0..];

                            if (strings.indexOf(bytes, "<Code>")) |start| {
                                if (strings.indexOf(bytes, "</Code>")) |end| {
                                    code = bytes[start + "<Code>".len .. end];
                                    has_body_code = true;
                                }
                            }
                            if (strings.indexOf(bytes, "<Message>")) |start| {
                                if (strings.indexOf(bytes, "</Message>")) |end| {
                                    message = bytes[start + "<Message>".len .. end];
                                    has_body_message = true;
                                }
                            }
                        }
                    }

                    err = .{
                        .code = code,
                        .message = message,
                    };
                }
                break :brk bun.MutableString{ .allocator = bun.default_allocator, .list = .{} };
            } else {
                const buffer = this.reported_response_buffer;
                break :brk buffer;
            }
        };
        log("reportProgres failed: {} has_more: {} len: {d}", .{ failed, has_more, chunk.list.items.len });
        if (failed) {
            if (!has_more) {
                this.callback(chunk, false, err, this.callback_context);
            }
        } else {
            // dont report empty chunks if we have more data to read
            if (!has_more or chunk.list.items.len > 0) {
                this.callback(chunk, has_more, null, this.callback_context);
                this.reported_response_buffer.reset();
            }
        }
    }
    /// this is the task callback from the last task result and is always in the main thread
    pub fn onResponse(this: *@This()) void {
        // lets lock and unlock the reported response buffer
        this.mutex.lock();
        // the state is atomic let's load it once
        const state = this.getState();
        const has_more = state.has_more;
        defer {
            // always unlock when done
            this.mutex.unlock();
            // if we dont have more we should deinit at the end of the function
            if (!has_more) this.deinit();
        }

        // there is no reason to set has_schedule_callback to true if we dont have more data to read
        if (has_more) this.has_schedule_callback.store(false, .monotonic);
        this.reportProgress(state);
    }

    /// this function is only called from the http callback in the HTTPThread and returns true if we should wait until we are done buffering the response body to report
    /// should only be called when already locked
    fn updateState(this: *@This(), async_http: *bun.http.AsyncHTTP, result: bun.http.HTTPClientResult, state: *State) bool {
        const is_done = !result.has_more;
        // if we got a error or fail wait until we are done buffering the response body to report
        var wait_until_done = false;
        {
            state.has_more = !is_done;

            state.request_error = if (result.fail) |err| @intFromError(err) else 0;
            if (state.status_code == 0) {
                if (result.certificate_info) |*certificate| {
                    certificate.deinit(bun.default_allocator);
                }
                if (result.metadata) |m| {
                    var metadata = m;
                    state.status_code = metadata.response.status_code;
                    metadata.deinit(bun.default_allocator);
                }
            }
            switch (state.status_code) {
                200, 204, 206 => wait_until_done = state.request_error != 0,
                else => wait_until_done = true,
            }
            // store the new state
            this.setState(state.*);
            this.http = async_http.*;
        }
        return wait_until_done;
    }

    /// this functions is only called from the http callback in the HTTPThread and returns true if we should enqueue another task
    fn processHttpCallback(this: *@This(), async_http: *bun.http.AsyncHTTP, result: bun.http.HTTPClientResult) bool {
        // lets lock and unlock to be safe we know the state is not in the middle of a callback when locked
        this.mutex.lock();
        defer this.mutex.unlock();

        // remember the state is atomic load it once, and store it again
        var state = this.getState();
        // old state should have more otherwise its a http.zig bug
        bun.assert(state.has_more);
        const is_done = !result.has_more;
        const wait_until_done = updateState(this, async_http, result, &state);
        const should_enqueue = !wait_until_done or is_done;
        log("state err: {} status_code: {} has_more: {} should_enqueue: {}", .{ state.request_error, state.status_code, state.has_more, should_enqueue });

        if (should_enqueue) {
            if (result.body) |body| {
                this.response_buffer = body.*;
                if (body.list.items.len > 0) {
                    _ = bun.handleOom(this.reported_response_buffer.write(body.list.items));
                }
                this.response_buffer.reset();
                if (this.reported_response_buffer.list.items.len == 0 and !is_done) {
                    return false;
                }
            } else if (!is_done) {
                return false;
            }
            if (this.has_schedule_callback.cmpxchgStrong(false, true, .acquire, .monotonic)) |has_schedule_callback| {
                if (has_schedule_callback) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
    /// this is the callback from the http.zig AsyncHTTP is always called from the HTTPThread
    pub fn httpCallback(this: *@This(), async_http: *bun.http.AsyncHTTP, result: bun.http.HTTPClientResult) void {
        if (processHttpCallback(this, async_http, result)) {
            // we are always unlocked here and its safe to enqueue
            this.vm.eventLoop().enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
        }
    }
};

const std = @import("std");
const S3Error = @import("./error.zig").S3Error;

const S3Credentials = @import("./credentials.zig").S3Credentials;
const SignResult = S3Credentials.SignResult;

const bun = @import("bun");
const jsc = bun.jsc;
const strings = bun.strings;
