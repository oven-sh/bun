const HTTPThread = @This();

var custom_ssl_context_map = std.AutoArrayHashMap(*SSLConfig, *NewHTTPContext(true)).init(bun.default_allocator);

loop: *jsc.MiniEventLoop,
http_context: NewHTTPContext(false),
https_context: NewHTTPContext(true),

queued_tasks: Queue = Queue{},

queued_shutdowns: std.ArrayListUnmanaged(ShutdownMessage) = std.ArrayListUnmanaged(ShutdownMessage){},
queued_writes: std.ArrayListUnmanaged(WriteMessage) = std.ArrayListUnmanaged(WriteMessage){},

queued_shutdowns_lock: bun.Mutex = .{},
queued_writes_lock: bun.Mutex = .{},

queued_proxy_deref: std.ArrayListUnmanaged(*ProxyTunnel) = std.ArrayListUnmanaged(*ProxyTunnel){},

has_awoken: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
timer: std.time.Timer,
lazy_libdeflater: ?*LibdeflateState = null,
lazy_request_body_buffer: ?*HeapRequestBodyBuffer = null,

pub const HeapRequestBodyBuffer = struct {
    buffer: [512 * 1024]u8 = undefined,
    fixed_buffer_allocator: std.heap.FixedBufferAllocator,

    pub const new = bun.TrivialNew(@This());
    pub const deinit = bun.TrivialDeinit(@This());

    pub fn init() *@This() {
        var this = HeapRequestBodyBuffer.new(.{
            .fixed_buffer_allocator = undefined,
        });
        this.fixed_buffer_allocator = std.heap.FixedBufferAllocator.init(&this.buffer);
        return this;
    }

    pub fn put(this: *@This()) void {
        if (bun.http.http_thread.lazy_request_body_buffer == null) {
            // This case hypothetically should never happen
            this.fixed_buffer_allocator.reset();
            bun.http.http_thread.lazy_request_body_buffer = this;
        } else {
            this.deinit();
        }
    }
};

pub const RequestBodyBuffer = union(enum) {
    heap: *HeapRequestBodyBuffer,
    stack: std.heap.StackFallbackAllocator(request_body_send_stack_buffer_size),

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .heap => |heap| heap.put(),
            .stack => {},
        }
    }

    pub fn allocatedSlice(this: *@This()) []u8 {
        return switch (this.*) {
            .heap => |heap| &heap.buffer,
            .stack => |*stack| &stack.buffer,
        };
    }

    pub fn allocator(this: *@This()) std.mem.Allocator {
        return switch (this.*) {
            .heap => |heap| heap.fixed_buffer_allocator.allocator(),
            .stack => |*stack| stack.get(),
        };
    }

    pub fn toArrayList(this: *@This()) std.ArrayList(u8) {
        var arraylist = std.ArrayList(u8).fromOwnedSlice(this.allocator(), this.allocatedSlice());
        arraylist.items.len = 0;
        return arraylist;
    }
};

const threadlog = Output.scoped(.HTTPThread, .hidden);
const WriteMessage = struct {
    async_http_id: u32,
    flags: packed struct(u8) {
        is_tls: bool,
        type: Type,
        _: u5 = 0,
    },

    pub const Type = enum(u2) {
        data = 0,
        end = 1,
        endChunked = 2,
    };
};
const ShutdownMessage = struct {
    async_http_id: u32,
    is_tls: bool,
};

pub const LibdeflateState = struct {
    decompressor: *bun.libdeflate.Decompressor = undefined,
    shared_buffer: [512 * 1024]u8 = undefined,

    pub const new = bun.TrivialNew(@This());
};

const request_body_send_stack_buffer_size = 32 * 1024;

pub inline fn getRequestBodySendBuffer(this: *@This(), estimated_size: usize) RequestBodyBuffer {
    if (estimated_size >= request_body_send_stack_buffer_size) {
        if (this.lazy_request_body_buffer == null) {
            log("Allocating HeapRequestBodyBuffer due to {d} bytes request body", .{estimated_size});
            return .{
                .heap = HeapRequestBodyBuffer.init(),
            };
        }

        return .{ .heap = bun.take(&this.lazy_request_body_buffer).? };
    }
    return .{
        .stack = std.heap.stackFallback(request_body_send_stack_buffer_size, bun.default_allocator),
    };
}

pub fn deflater(this: *@This()) *LibdeflateState {
    if (this.lazy_libdeflater == null) {
        this.lazy_libdeflater = LibdeflateState.new(.{
            .decompressor = bun.libdeflate.Decompressor.alloc() orelse bun.outOfMemory(),
        });
    }

    return this.lazy_libdeflater.?;
}

fn onInitErrorNoop(err: InitError, opts: InitOpts) noreturn {
    switch (err) {
        error.LoadCAFile => {
            if (!bun.sys.existsZ(opts.abs_ca_file_name)) {
                Output.err("HTTPThread", "failed to find CA file: '{s}'", .{opts.abs_ca_file_name});
            } else {
                Output.err("HTTPThread", "failed to load CA file: '{s}'", .{opts.abs_ca_file_name});
            }
        },
        error.InvalidCAFile => {
            Output.err("HTTPThread", "the CA file is invalid: '{s}'", .{opts.abs_ca_file_name});
        },
        error.InvalidCA => {
            Output.err("HTTPThread", "the provided CA is invalid", .{});
        },
        error.FailedToOpenSocket => {
            Output.errGeneric("failed to start HTTP client thread", .{});
        },
    }
    Global.crash();
}

pub const InitOpts = struct {
    ca: []stringZ = &.{},
    abs_ca_file_name: stringZ = &.{},
    for_install: bool = false,

    onInitError: *const fn (err: InitError, opts: InitOpts) noreturn = &onInitErrorNoop,
};

fn initOnce(opts: *const InitOpts) void {
    bun.http.http_thread = .{
        .loop = undefined,
        .http_context = .{
            .us_socket_context = undefined,
            .pending_sockets = NewHTTPContext(false).PooledSocketHiveAllocator.empty,
        },
        .https_context = .{
            .us_socket_context = undefined,
            .pending_sockets = NewHTTPContext(true).PooledSocketHiveAllocator.empty,
        },
        .timer = std.time.Timer.start() catch unreachable,
    };
    bun.libdeflate.load();
    const thread = std.Thread.spawn(
        .{
            .stack_size = bun.default_thread_stack_size,
        },
        onStart,
        .{opts.*},
    ) catch |err| Output.panic("Failed to start HTTP Client thread: {s}", .{@errorName(err)});
    thread.detach();
}
var init_once = bun.once(initOnce);

pub fn init(opts: *const InitOpts) void {
    init_once.call(.{opts});
}

pub fn onStart(opts: InitOpts) void {
    Output.Source.configureNamedThread("HTTP Client");
    bun.http.default_arena = Arena.init();
    bun.http.default_allocator = bun.http.default_arena.allocator();

    const loop = bun.jsc.MiniEventLoop.initGlobal(null);

    if (Environment.isWindows) {
        _ = std.process.getenvW(comptime bun.strings.w("SystemRoot")) orelse {
            bun.Output.errGeneric("The %SystemRoot% environment variable is not set. Bun needs this set in order for network requests to work.", .{});
            Global.crash();
        };
    }

    bun.http.http_thread.loop = loop;
    bun.http.http_thread.http_context.init();
    bun.http.http_thread.https_context.initWithThreadOpts(&opts) catch |err| opts.onInitError(err, opts);
    bun.http.http_thread.has_awoken.store(true, .monotonic);
    bun.http.http_thread.processEvents();
}

pub fn connect(this: *@This(), client: *HTTPClient, comptime is_ssl: bool) !NewHTTPContext(is_ssl).HTTPSocket {
    if (client.unix_socket_path.length() > 0) {
        return try this.context(is_ssl).connectSocket(client, client.unix_socket_path.slice());
    }

    if (comptime is_ssl) {
        const needs_own_context = client.tls_props != null and client.tls_props.?.requires_custom_request_ctx;
        if (needs_own_context) {
            var requested_config = client.tls_props.?;
            for (custom_ssl_context_map.keys()) |other_config| {
                if (requested_config.isSame(other_config)) {
                    // we free the callers config since we have a existing one
                    if (requested_config != client.tls_props) {
                        requested_config.deinit();
                        bun.default_allocator.destroy(requested_config);
                    }
                    client.tls_props = other_config;
                    if (client.http_proxy) |url| {
                        return try custom_ssl_context_map.get(other_config).?.connect(client, url.hostname, url.getPortAuto());
                    } else {
                        return try custom_ssl_context_map.get(other_config).?.connect(client, client.url.hostname, client.url.getPortAuto());
                    }
                }
            }
            // we need the config so dont free it
            var custom_context = try bun.default_allocator.create(NewHTTPContext(is_ssl));
            custom_context.initWithClientConfig(client) catch |err| {
                client.tls_props = null;

                requested_config.deinit();
                bun.default_allocator.destroy(requested_config);
                bun.default_allocator.destroy(custom_context);

                // TODO: these error names reach js. figure out how they should be handled
                return switch (err) {
                    error.FailedToOpenSocket => |e| e,
                    error.InvalidCA => error.FailedToOpenSocket,
                    error.InvalidCAFile => error.FailedToOpenSocket,
                    error.LoadCAFile => error.FailedToOpenSocket,
                };
            };
            try custom_ssl_context_map.put(requested_config, custom_context);
            // We might deinit the socket context, so we disable keepalive to make sure we don't
            // free it while in use.
            client.flags.disable_keepalive = true;
            if (client.http_proxy) |url| {
                // https://github.com/oven-sh/bun/issues/11343
                if (url.protocol.len == 0 or strings.eqlComptime(url.protocol, "https") or strings.eqlComptime(url.protocol, "http")) {
                    return try this.context(is_ssl).connect(client, url.hostname, url.getPortAuto());
                }
                return error.UnsupportedProxyProtocol;
            }
            return try custom_context.connect(client, client.url.hostname, client.url.getPortAuto());
        }
    }
    if (client.http_proxy) |url| {
        if (url.href.len > 0) {
            // https://github.com/oven-sh/bun/issues/11343
            if (url.protocol.len == 0 or strings.eqlComptime(url.protocol, "https") or strings.eqlComptime(url.protocol, "http")) {
                return try this.context(is_ssl).connect(client, url.hostname, url.getPortAuto());
            }
            return error.UnsupportedProxyProtocol;
        }
    }
    return try this.context(is_ssl).connect(client, client.url.hostname, client.url.getPortAuto());
}

pub fn context(this: *@This(), comptime is_ssl: bool) *NewHTTPContext(is_ssl) {
    return if (is_ssl) &this.https_context else &this.http_context;
}

fn drainEvents(this: *@This()) void {
    {
        this.queued_shutdowns_lock.lock();
        defer this.queued_shutdowns_lock.unlock();
        for (this.queued_shutdowns.items) |http| {
            if (bun.http.socket_async_http_abort_tracker.fetchSwapRemove(http.async_http_id)) |socket_ptr| {
                if (http.is_tls) {
                    const socket = uws.SocketTLS.fromAny(socket_ptr.value);
                    // do a fast shutdown here since we are aborting and we dont want to wait for the close_notify from the other side
                    socket.close(.failure);
                } else {
                    const socket = uws.SocketTCP.fromAny(socket_ptr.value);
                    socket.close(.failure);
                }
            }
        }
        this.queued_shutdowns.clearRetainingCapacity();
    }
    {
        this.queued_writes_lock.lock();
        defer this.queued_writes_lock.unlock();
        for (this.queued_writes.items) |write| {
            const flags = write.flags;
            const messageType = flags.type;
            const ended = messageType == .end or messageType == .endChunked;

            if (bun.http.socket_async_http_abort_tracker.get(write.async_http_id)) |socket_ptr| {
                switch (flags.is_tls) {
                    inline true, false => |is_tls| {
                        const socket = uws.NewSocketHandler(is_tls).fromAny(socket_ptr);
                        if (socket.isClosed() or socket.isShutdown()) {
                            continue;
                        }
                        const tagged = NewHTTPContext(is_tls).getTaggedFromSocket(socket);
                        if (tagged.get(HTTPClient)) |client| {
                            if (client.state.original_request_body == .stream) {
                                var stream = &client.state.original_request_body.stream;
                                stream.ended = ended;
                                if (messageType == .endChunked) {
                                    // only send the 0-length chunk if the request body is chunked
                                    client.writeToStream(is_tls, socket, bun.http.end_of_chunked_http1_1_encoding_response_body);
                                } else {
                                    client.flushStream(is_tls, socket);
                                }
                            }
                        }
                    },
                }
            }
        }
        this.queued_writes.clearRetainingCapacity();
    }

    while (this.queued_proxy_deref.pop()) |http| {
        http.deref();
    }

    var count: usize = 0;
    var active = AsyncHTTP.active_requests_count.load(.monotonic);
    const max = AsyncHTTP.max_simultaneous_requests.load(.monotonic);
    if (active >= max) return;
    defer {
        if (comptime Environment.allow_assert) {
            if (count > 0)
                log("Processed {d} tasks\n", .{count});
        }
    }

    while (this.queued_tasks.pop()) |http| {
        var cloned = bun.http.ThreadlocalAsyncHTTP.new(.{
            .async_http = http.*,
        });
        cloned.async_http.real = http;
        cloned.async_http.onStart();
        if (comptime Environment.allow_assert) {
            count += 1;
        }

        active += 1;
        if (active >= max) break;
    }
}

fn processEvents(this: *@This()) noreturn {
    if (comptime Environment.isPosix) {
        this.loop.loop.num_polls = @max(2, this.loop.loop.num_polls);
    } else if (comptime Environment.isWindows) {
        this.loop.loop.inc();
    } else {
        @compileError("TODO:");
    }

    while (true) {
        this.drainEvents();

        var start_time: i128 = 0;
        if (comptime Environment.isDebug) {
            start_time = std.time.nanoTimestamp();
        }
        Output.flush();

        this.loop.loop.inc();
        this.loop.loop.tick();
        this.loop.loop.dec();

        // this.loop.run();
        if (comptime Environment.isDebug) {
            const end = std.time.nanoTimestamp();
            threadlog("Waited {any}\n", .{std.fmt.fmtDurationSigned(@as(i64, @truncate(end - start_time)))});
            Output.flush();
        }
    }
}

pub fn scheduleShutdown(this: *@This(), http: *AsyncHTTP) void {
    {
        this.queued_shutdowns_lock.lock();
        defer this.queued_shutdowns_lock.unlock();
        this.queued_shutdowns.append(bun.default_allocator, .{
            .async_http_id = http.async_http_id,
            .is_tls = http.client.isHTTPS(),
        }) catch bun.outOfMemory();
    }
    if (this.has_awoken.load(.monotonic))
        this.loop.loop.wakeup();
}

pub fn scheduleRequestWrite(this: *@This(), http: *AsyncHTTP, messageType: WriteMessage.Type) void {
    {
        this.queued_writes_lock.lock();
        defer this.queued_writes_lock.unlock();
        this.queued_writes.append(bun.default_allocator, .{
            .async_http_id = http.async_http_id,
            .flags = .{
                .is_tls = http.client.isHTTPS(),
                .type = messageType,
            },
        }) catch bun.outOfMemory();
    }
    if (this.has_awoken.load(.monotonic))
        this.loop.loop.wakeup();
}

pub fn scheduleProxyDeref(this: *@This(), proxy: *ProxyTunnel) void {
    // this is always called on the http thread
    {
        this.queued_proxy_deref.append(bun.default_allocator, proxy) catch bun.outOfMemory();
    }
    if (this.has_awoken.load(.monotonic))
        this.loop.loop.wakeup();
}

pub fn wakeup(this: *@This()) void {
    if (this.has_awoken.load(.monotonic))
        this.loop.loop.wakeup();
}

pub fn schedule(this: *@This(), batch: Batch) void {
    if (batch.len == 0)
        return;

    {
        var batch_ = batch;
        while (batch_.pop()) |task| {
            const http: *AsyncHTTP = @fieldParentPtr("task", task);
            this.queued_tasks.push(http);
        }
    }

    if (this.has_awoken.load(.monotonic))
        this.loop.loop.wakeup();
}

pub const Queue = UnboundedQueue(AsyncHTTP, .next);

const log = Output.scoped(.HTTPThread, .visible);

const stringZ = [:0]const u8;

const ProxyTunnel = @import("./ProxyTunnel.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const jsc = bun.jsc;
const strings = bun.strings;
const uws = bun.uws;
const Arena = bun.allocators.MimallocArena;
const Batch = bun.ThreadPool.Batch;
const UnboundedQueue = bun.threading.UnboundedQueue;
const SSLConfig = bun.api.server.ServerConfig.SSLConfig;

const HTTPClient = bun.http;
const AsyncHTTP = bun.http.AsyncHTTP;
const InitError = HTTPClient.InitError;
const NewHTTPContext = bun.http.NewHTTPContext;
