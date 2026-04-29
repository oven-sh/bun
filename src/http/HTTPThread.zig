const HTTPThread = @This();

/// SSL context cache keyed by interned SSLConfig pointer.
/// Since configs are interned via SSLConfig.GlobalRegistry, pointer equality
/// is sufficient for lookup. Each entry holds a ref on its SSLConfig.
const SslContextCacheEntry = struct {
    ctx: *NewHTTPContext(true),
    last_used_ns: u64,
    /// Strong ref held by the cache entry (released on eviction).
    config_ref: SSLConfig.SharedPtr,
};
const ssl_context_cache_max_size = 60;
const ssl_context_cache_ttl_ns = 30 * std.time.ns_per_min;
var custom_ssl_context_map = std.AutoArrayHashMap(*SSLConfig, SslContextCacheEntry).init(bun.default_allocator);

loop: *jsc.MiniEventLoop,
http_context: NewHTTPContext(false),
https_context: NewHTTPContext(true),

queued_tasks: Queue = Queue{},
/// Tasks popped from `queued_tasks` that couldn't start because
/// `active_requests_count >= max_simultaneous_requests`. Kept in FIFO order
/// and processed before `queued_tasks` on the next `drainEvents`. Owned by
/// the HTTP thread; never accessed concurrently.
deferred_tasks: std.ArrayListUnmanaged(*AsyncHTTP) = .{},
/// Set by `drainQueuedShutdowns` when a shutdown's `async_http_id` wasn't in
/// `socket_async_http_abort_tracker` — the request is either not yet started
/// (still in `queued_tasks`/`deferred_tasks`) or already done. `drainEvents`
/// uses this to decide whether it must scan the queued/deferred lists for
/// aborted tasks when `active >= max`; without it the common at-capacity
/// path stays O(1). Owned by the HTTP thread.
has_pending_queued_abort: bool = false,

queued_shutdowns: std.ArrayListUnmanaged(ShutdownMessage) = std.ArrayListUnmanaged(ShutdownMessage){},
queued_writes: std.ArrayListUnmanaged(WriteMessage) = std.ArrayListUnmanaged(WriteMessage){},
queued_response_body_drains: std.ArrayListUnmanaged(DrainMessage) = std.ArrayListUnmanaged(DrainMessage){},

queued_shutdowns_lock: bun.Mutex = .{},
queued_writes_lock: bun.Mutex = .{},
queued_response_body_drains_lock: bun.Mutex = .{},

queued_threadlocal_proxy_derefs: std.ArrayListUnmanaged(*ProxyTunnel) = std.ArrayListUnmanaged(*ProxyTunnel){},

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
            this.fixed_buffer_allocator.reset();
            bun.http.http_thread.lazy_request_body_buffer = this;
        } else {
            // This case hypothetically should never happen
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

    pub fn toArrayList(this: *@This()) std.array_list.Managed(u8) {
        var arraylist = std.array_list.Managed(u8).fromOwnedSlice(this.allocator(), this.allocatedSlice());
        arraylist.items.len = 0;
        return arraylist;
    }
};

const threadlog = Output.scoped(.HTTPThread, .hidden);
const WriteMessage = struct {
    async_http_id: u32,
    message_type: Type,

    pub const Type = enum(u2) {
        data = 0,
        end = 1,
    };
};
const DrainMessage = struct {
    async_http_id: u32,
};
const ShutdownMessage = struct {
    async_http_id: u32,
};

pub const LibdeflateState = struct {
    decompressor: *bun.libdeflate.Decompressor = undefined,
    shared_buffer: [512 * 1024]u8 = undefined,

    pub const new = bun.TrivialNew(@This());

    pub fn deinit(this: *@This()) void {
        this.decompressor.deinit();
        bun.TrivialDeinit(@This())(this);
    }
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
            .ref_count = .init(),
            .pending_sockets = NewHTTPContext(false).PooledSocketHiveAllocator.empty,
        },
        .https_context = .{
            .ref_count = .init(),
            .pending_sockets = NewHTTPContext(true).PooledSocketHiveAllocator.empty,
        },
        .timer = std.time.Timer.start() catch unreachable,
    };
    bun.libdeflate.load();
    spawnHttpClientThread(opts.*) catch |err| {
        // Refs:
        //   https://github.com/oven-sh/bun/issues/29933
        //   https://github.com/oven-sh/bun/issues/24878
        //   https://github.com/oven-sh/bun/issues/22080
        //   https://github.com/oven-sh/bun/issues/19085
        //   https://github.com/oven-sh/bun/issues/14424
        //
        // On Windows, `spawnHttpClientThread` captures the Win32 error at the
        // `CreateThread` failure site so the panic message is actionable
        // (ERROR_NOT_ENOUGH_MEMORY, ERROR_TOO_MANY_THREADS, etc.) instead of
        // the bare "Unexpected" from std.Thread.spawn.
        var buf: [256]u8 = undefined;
        const win32_error_code: u16 = if (comptime Environment.isWindows)
            @intFromEnum(last_http_thread_spawn_win32_error)
        else
            0;
        const msg = formatSpawnFailurePanic(&buf, @errorName(err), win32_error_code, Environment.isWindows);
        Output.panic("{s}", .{msg});
    };
}

/// Format the panic message for a failed HTTP thread spawn. Pure — takes
/// a scratch buffer, the Zig error name, the captured Win32 error code,
/// and whether the caller is running on Windows (so the message is
/// deterministic regardless of the host platform; callers in the real
/// panic path pass `Environment.isWindows`).
///
/// On Windows the message includes the Win32 error code so crash reports
/// for #29933 and friends are actionable (ERROR_NOT_ENOUGH_MEMORY,
/// ERROR_TOO_MANY_THREADS, etc.) rather than the opaque "Unexpected"
/// that std.Thread.spawn produces.
///
/// `win32_error_code` is ignored when `is_windows` is false. The buffer
/// should be at least 128 bytes; if formatting overflows it, the static
/// fallback string is returned directly (buf contents are not used).
pub fn formatSpawnFailurePanic(buf: []u8, err_name: []const u8, win32_error_code: u16, is_windows: bool) []const u8 {
    // If bufPrint overflows, return the static fallback string directly.
    // Slicing `buf` itself would expose uninitialized stack memory.
    const fallback = "Failed to start HTTP Client thread";
    if (is_windows) {
        return std.fmt.bufPrint(
            buf,
            "Failed to start HTTP Client thread: {s} (Win32 error 0x{x})",
            .{ err_name, win32_error_code },
        ) catch fallback;
    }
    return std.fmt.bufPrint(
        buf,
        "Failed to start HTTP Client thread: {s}",
        .{err_name},
    ) catch fallback;
}

pub const TestingAPIs = struct {
    /// Exercises `formatSpawnFailurePanic` so tests can verify the
    /// Windows panic message includes the Win32 error code captured by
    /// `spawnHttpClientThread` (#29933). The formatter is pure so this
    /// runs on any platform — the `is_windows` arg selects which branch
    /// to render.
    pub fn formatHttpThreadSpawnPanic(
        globalThis: *bun.jsc.JSGlobalObject,
        callframe: *bun.jsc.CallFrame,
    ) bun.JSError!bun.jsc.JSValue {
        const arguments = callframe.arguments();
        if (arguments.len < 3 or !arguments[0].isString() or !arguments[1].isNumber() or !arguments[2].isBoolean()) {
            return globalThis.throw("formatHttpThreadSpawnPanic: expected (err_name: string, win32_error_code: number, is_windows: boolean)", .{});
        }
        const err_name_str = try arguments[0].toBunString(globalThis);
        defer err_name_str.deref();
        const err_name_slice = err_name_str.toUTF8(bun.default_allocator);
        defer err_name_slice.deinit();

        const code_i32 = arguments[1].toInt32();
        const code: u16 = if (code_i32 < 0 or code_i32 > std.math.maxInt(u16))
            0
        else
            @intCast(code_i32);
        const is_windows = arguments[2].toBoolean();

        var buf: [256]u8 = undefined;
        const msg = formatSpawnFailurePanic(&buf, err_name_slice.slice(), code, is_windows);
        return bun.String.createUTF8ForJS(globalThis, msg);
    }
};

/// Only written on Windows; read on Windows in the panic path for
/// `initOnce` when `spawnHttpClientThread` fails. Captures the
/// `GetLastError()` value right at the `CreateThread` failure site
/// before any cleanup (HeapFree, etc.) can clobber it.
var last_http_thread_spawn_win32_error: if (Environment.isWindows)
    std.os.windows.Win32Error
else
    void = if (Environment.isWindows) .SUCCESS else {};

/// Superset of `std.Thread.SpawnError` plus the Windows-only
/// `SpawnFailed` we return when `CreateThread` fails. We keep every POSIX
/// variant name so `@errorName` in `formatSpawnFailurePanic` reports
/// e.g. `ThreadQuotaExceeded` / `SystemResources` verbatim instead of
/// collapsing to `Unexpected`.
const HttpThreadSpawnError = std.Thread.SpawnError || error{SpawnFailed};

/// Spawns the HTTP client thread with a detached handle.
///
/// On Windows, this is hand-rolled instead of using `std.Thread.spawn` so
/// we can capture the `GetLastError()` value at the `CreateThread`
/// failure site. `std.Thread.spawn`'s Windows backend has an
/// `errdefer HeapFree(...)` that runs between `CreateThread` failing
/// and the caller's `catch`, which clobbers the thread-local last-error
/// and turns every failure into a bare `error.Unexpected`. See
/// `vendor/zig/lib/std/Thread.zig` — WindowsThreadImpl.spawn.
fn spawnHttpClientThread(opts: InitOpts) HttpThreadSpawnError!void {
    if (comptime !Environment.isWindows) {
        const thread = try std.Thread.spawn(
            .{ .stack_size = bun.default_thread_stack_size },
            onStart,
            .{opts},
        );
        thread.detach();
        return;
    }

    const windows = std.os.windows;
    const kernel32 = windows.kernel32;

    const Instance = struct {
        opts: InitOpts,

        fn entryFn(raw_ptr: windows.PVOID) callconv(.winapi) windows.DWORD {
            const self: *@This() = @ptrCast(@alignCast(raw_ptr));
            // The spawned thread now owns the allocation; free it once
            // `onStart` enters so we don't leak on a clean start either.
            // (onStart doesn't return under normal conditions, but if it
            // ever did, the allocation would be unreachable anyway.)
            const heap = kernel32.GetProcessHeap() orelse {
                onStart(self.opts);
                return 0;
            };
            const captured_opts = self.opts;
            _ = kernel32.HeapFree(heap, 0, raw_ptr);
            onStart(captured_opts);
            return 0;
        }
    };

    const heap_handle = kernel32.GetProcessHeap() orelse {
        last_http_thread_spawn_win32_error = bun.windows.GetLastError();
        return error.OutOfMemory;
    };
    // HeapAlloc does NOT call SetLastError on failure (per MSDN: "An
    // application cannot call GetLastError for extended error
    // information"), so reading it here would surface a stale code from
    // some unrelated prior Win32 call. Leave `last_http_thread_spawn_win32_error`
    // at its default .SUCCESS — the Zig error name `OutOfMemory` in the
    // panic message already conveys the cause, and printing 0x0 is less
    // misleading than printing a red-herring code.
    const alloc_ptr = kernel32.HeapAlloc(heap_handle, 0, @sizeOf(Instance)) orelse {
        return error.OutOfMemory;
    };
    const instance: *Instance = @ptrCast(@alignCast(alloc_ptr));
    instance.* = .{ .opts = opts };

    // Mirror std.Thread: Windows treats stack_size as a hint and enforces
    // a floor of 64KB (SYSTEM_INFO.dwAllocationGranularity on x64/arm64).
    var stack_size: u32 = std.math.cast(u32, bun.default_thread_stack_size) orelse std.math.maxInt(u32);
    stack_size = @max(64 * 1024, stack_size);

    // STACK_SIZE_PARAM_IS_A_RESERVATION (0x00010000): treat stack_size
    // as the *reserve* size; Windows commits the initial guard page and
    // grows committed memory on demand. Without this flag, stack_size
    // is the initial *commit* size — with the 4MB default, that's
    // ~4MB of commit charge per thread upfront, which makes the exact
    // ERROR_NOT_ENOUGH_MEMORY / ERROR_COMMITMENT_LIMIT case this PR
    // diagnoses slightly more likely.
    const STACK_SIZE_PARAM_IS_A_RESERVATION: windows.DWORD = 0x00010000;
    const thread_handle = kernel32.CreateThread(
        null,
        stack_size,
        Instance.entryFn,
        instance,
        STACK_SIZE_PARAM_IS_A_RESERVATION,
        null,
    ) orelse {
        // Capture BEFORE HeapFree runs — HeapFree can clear the last-error
        // on success, which is what makes the stdlib spawn unhelpful.
        last_http_thread_spawn_win32_error = bun.windows.GetLastError();
        _ = kernel32.HeapFree(heap_handle, 0, alloc_ptr);
        return error.SpawnFailed;
    };
    // Detach: the thread owns the allocation and will free it on entry.
    windows.CloseHandle(thread_handle);
}
var init_once = bun.once(initOnce);

pub fn init(opts: *const InitOpts) void {
    init_once.call(.{opts});
}

pub fn onStart(opts: InitOpts) void {
    Output.Source.configureNamedThread("HTTP Client");
    bun.http.default_arena = Arena.init();
    bun.http.default_allocator = bun.http.default_arena.allocator();

    const loop = bun.jsc.MiniEventLoop.initGlobal(null, null);

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

pub fn connect(this: *@This(), client: *HTTPClient, comptime is_ssl: bool) !?NewHTTPContext(is_ssl).HTTPSocket {
    if (client.unix_socket_path.length() > 0) {
        return try this.context(is_ssl).connectSocket(client, client.unix_socket_path.slice());
    }

    if (comptime is_ssl) custom_ctx: {
        if (client.tls_props) |tls| {
            if (!tls.get().requires_custom_request_ctx) break :custom_ctx;
            const requested_config = tls.get();

            // Evict stale entries from the cache
            evictStaleSslContexts(this);

            // Look up by pointer equality (configs are interned)
            if (custom_ssl_context_map.getPtr(requested_config)) |entry| {
                // Cache hit - reuse existing SSL context
                entry.last_used_ns = this.timer.read();
                client.setCustomSslCtx(entry.ctx);
                // Keepalive is now supported for custom SSL contexts
                if (client.http_proxy) |url| {
                    return try entry.ctx.connect(client, url.hostname, url.getPortAuto());
                } else {
                    return try entry.ctx.connect(client, client.url.hostname, client.url.getPortAuto());
                }
            }

            // Cache miss - create new SSL context
            var custom_context = try bun.default_allocator.create(NewHTTPContext(is_ssl));
            custom_context.* = .{
                .ref_count = .init(),
                .pending_sockets = NewHTTPContext(is_ssl).PooledSocketHiveAllocator.empty,
            };
            custom_context.initWithClientConfig(client) catch |err| {
                bun.default_allocator.destroy(custom_context);

                return switch (err) {
                    error.FailedToOpenSocket => |e| e,
                    error.InvalidCA => error.FailedToOpenSocket,
                    error.InvalidCAFile => error.FailedToOpenSocket,
                    error.LoadCAFile => error.FailedToOpenSocket,
                };
            };

            const now = this.timer.read();
            bun.handleOom(custom_ssl_context_map.put(requested_config, .{
                .ctx = custom_context,
                .last_used_ns = now,
                // Clone a strong ref for the cache entry; client.tls_props keeps its own.
                .config_ref = tls.clone(),
            }));

            // Enforce max cache size - evict oldest entry
            if (custom_ssl_context_map.count() > ssl_context_cache_max_size) {
                evictOldestSslContext();
            }

            client.setCustomSslCtx(custom_context);
            // Keepalive is now supported for custom SSL contexts
            if (client.http_proxy) |url| {
                if (url.protocol.len == 0 or strings.eqlComptime(url.protocol, "https") or strings.eqlComptime(url.protocol, "http")) {
                    return try custom_context.connect(client, url.hostname, url.getPortAuto());
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

/// Evict SSL context cache entries that haven't been used for ssl_context_cache_ttl_ns.
fn evictStaleSslContexts(this: *@This()) void {
    const now = this.timer.read();
    var i: usize = 0;
    while (i < custom_ssl_context_map.count()) {
        var entry = custom_ssl_context_map.values()[i];
        if (now -| entry.last_used_ns > ssl_context_cache_ttl_ns) {
            custom_ssl_context_map.swapRemoveAt(i);
            entry.ctx.deref();
            entry.config_ref.deinit();
        } else {
            i += 1;
        }
    }
}

/// Evict the least-recently-used SSL context cache entry.
fn evictOldestSslContext() void {
    if (custom_ssl_context_map.count() == 0) return;
    var oldest_idx: usize = 0;
    var oldest_time: u64 = std.math.maxInt(u64);
    for (custom_ssl_context_map.values(), 0..) |entry, i| {
        if (entry.last_used_ns < oldest_time) {
            oldest_time = entry.last_used_ns;
            oldest_idx = i;
        }
    }
    var entry = custom_ssl_context_map.values()[oldest_idx];
    custom_ssl_context_map.swapRemoveAt(oldest_idx);
    entry.ctx.deref();
    entry.config_ref.deinit();
}

fn abortPendingH2Waiter(this: *@This(), async_http_id: u32) bool {
    if (this.https_context.abortPendingH2Waiter(async_http_id)) return true;
    for (custom_ssl_context_map.values()) |entry| {
        if (entry.ctx.abortPendingH2Waiter(async_http_id)) return true;
    }
    return false;
}

fn drainQueuedShutdowns(this: *@This()) void {
    while (true) {
        // socket.close() can potentially be slow
        // Let's not block other threads while this runs.
        var queued_shutdowns = brk: {
            this.queued_shutdowns_lock.lock();
            defer this.queued_shutdowns_lock.unlock();
            const shutdowns = this.queued_shutdowns;
            this.queued_shutdowns = .{};
            break :brk shutdowns;
        };
        defer queued_shutdowns.deinit(bun.default_allocator);

        for (queued_shutdowns.items) |http| {
            if (bun.http.socket_async_http_abort_tracker.fetchSwapRemove(http.async_http_id)) |socket_ptr| {
                switch (socket_ptr.value) {
                    inline .SocketTLS, .SocketTCP => |socket, tag| {
                        const is_tls = tag == .SocketTLS;
                        const HTTPContext = HTTPThread.NewHTTPContext(comptime is_tls);
                        const tagged = HTTPContext.getTaggedFromSocket(socket);
                        if (tagged.get(HTTPClient)) |client| {
                            // If we only call socket.close(), then it won't
                            // call `onClose` if this happens before `onOpen` is
                            // called.
                            //
                            client.closeAndAbort(comptime is_tls, socket);
                            continue;
                        }
                        if (tagged.get(bun.http.H2.ClientSession)) |session| {
                            session.abortByHttpId(http.async_http_id);
                            continue;
                        }
                        socket.close(.failure);
                    },
                }
            } else {
                // No socket for this id. It may be a request coalesced onto a
                // leader's in-flight h2 TLS connect (parked in `pc.waiters`
                // with no abort-tracker entry); scan those first so the abort
                // doesn't wait for the leader's connect to resolve.
                if (this.abortPendingH2Waiter(http.async_http_id)) continue;
                // Or it's on an HTTP/3 session, which has no TCP socket to
                // register in the tracker.
                if (bun.http.H3.ClientContext.abortByHttpId(http.async_http_id)) continue;
                // Otherwise the request either hasn't started yet (still in
                // `queued_tasks`/`deferred_tasks`) or has already completed.
                // Flag it so `drainEvents` knows to scan the queue for
                // aborted-but-unstarted tasks even when `active >= max`
                // would otherwise short-circuit.
                this.has_pending_queued_abort = true;
            }
        }
        if (queued_shutdowns.items.len == 0) {
            break;
        }
        threadlog("drained {d} queued shutdowns", .{queued_shutdowns.items.len});
    }
}

fn drainQueuedWrites(this: *@This()) void {
    while (true) {
        var queued_writes = brk: {
            this.queued_writes_lock.lock();
            defer this.queued_writes_lock.unlock();
            const writes = this.queued_writes;
            this.queued_writes = .{};
            break :brk writes;
        };
        defer queued_writes.deinit(bun.default_allocator);
        for (queued_writes.items) |write| {
            const message = write.message_type;
            const ended = message == .end;

            if (bun.http.socket_async_http_abort_tracker.get(write.async_http_id)) |socket_ptr| {
                switch (socket_ptr) {
                    inline .SocketTLS, .SocketTCP => |socket, tag| {
                        const is_tls = tag == .SocketTLS;
                        if (socket.isClosed() or socket.isShutdown()) {
                            continue;
                        }
                        const tagged = NewHTTPContext(comptime is_tls).getTaggedFromSocket(socket);
                        if (tagged.get(HTTPClient)) |client| {
                            if (client.state.original_request_body == .stream) {
                                var stream = &client.state.original_request_body.stream;
                                stream.ended = ended;

                                client.flushStream(is_tls, socket);
                            }
                        }
                        if (tagged.get(bun.http.H2.ClientSession)) |session| {
                            session.streamBodyByHttpId(write.async_http_id, ended);
                        }
                    },
                }
            } else {
                bun.http.H3.ClientContext.streamBodyByHttpId(write.async_http_id, ended);
            }
        }
        if (queued_writes.items.len == 0) {
            break;
        }
        threadlog("drained {d} queued writes", .{queued_writes.items.len});
    }
}

fn drainQueuedHTTPResponseBodyDrains(this: *@This()) void {
    while (true) {
        // socket.close() can potentially be slow
        // Let's not block other threads while this runs.
        var queued_response_body_drains = brk: {
            this.queued_response_body_drains_lock.lock();
            defer this.queued_response_body_drains_lock.unlock();
            const drains = this.queued_response_body_drains;
            this.queued_response_body_drains = .{};
            break :brk drains;
        };
        defer queued_response_body_drains.deinit(bun.default_allocator);

        for (queued_response_body_drains.items) |drain| {
            if (bun.http.socket_async_http_abort_tracker.get(drain.async_http_id)) |socket_ptr| {
                switch (socket_ptr) {
                    inline .SocketTLS, .SocketTCP => |socket, tag| {
                        const is_tls = tag == .SocketTLS;
                        const HTTPContext = HTTPThread.NewHTTPContext(comptime is_tls);
                        const tagged = HTTPContext.getTaggedFromSocket(socket);
                        if (tagged.get(HTTPClient)) |client| {
                            client.drainResponseBody(comptime is_tls, socket);
                        }
                        if (tagged.get(bun.http.H2.ClientSession)) |session| {
                            session.drainResponseBodyByHttpId(drain.async_http_id);
                        }
                    },
                }
            }
        }
        if (queued_response_body_drains.items.len == 0) {
            break;
        }
        threadlog("drained {d} queued drains", .{queued_response_body_drains.items.len});
    }
}

fn drainEvents(this: *@This()) void {
    // Process any pending writes **before** aborting.
    this.drainQueuedHTTPResponseBodyDrains();
    this.drainQueuedWrites();
    this.drainQueuedShutdowns();
    bun.http.H3.PendingConnect.drainResolved();

    for (this.queued_threadlocal_proxy_derefs.items) |http| {
        http.deref();
    }
    this.queued_threadlocal_proxy_derefs.clearRetainingCapacity();

    var count: usize = 0;
    var active = AsyncHTTP.active_requests_count.load(.monotonic);
    const max = AsyncHTTP.max_simultaneous_requests.load(.monotonic);
    defer {
        if (comptime Environment.allow_assert) {
            if (count > 0)
                log("Processed {d} tasks\n", .{count});
        }
    }

    // Fast path: at capacity and no queued/deferred task could possibly be
    // aborted. A queued task can only become aborted via `scheduleShutdown`,
    // which we just drained — `drainQueuedShutdowns` sets
    // `has_pending_queued_abort` for any id it couldn't find in the socket
    // tracker. If that's clear, there's nothing to fail-fast and nothing can
    // start, so don't walk the lists.
    if (active >= max and !this.has_pending_queued_abort) return;

    // Deferred tasks are ones we previously popped from the MPSC queue but
    // couldn't start because we were at max. They stay in FIFO order ahead of
    // anything still in `queued_tasks`.
    //
    // Already-aborted tasks are started regardless of `max`: `start_()` will
    // observe the `aborted` signal and fail immediately with
    // `error.AbortedBeforeConnecting`, and `onAsyncHTTPCallback` decrements
    // `active_requests_count` in the same turn — so they never hold a slot.
    // Without this, an aborted fetch that was queued behind `max` would sit
    // there until some unrelated request completed; if every active request
    // is itself hung, the aborted one never settles and its promise hangs
    // forever even though the user called `controller.abort()`.
    //
    // `startQueuedTask` can re-enter `onAsyncHTTPCallback` synchronously (for
    // aborted tasks, or when connect() fails immediately), which reads both
    // `active_requests_count` and `deferred_tasks.items.len` to decide whether
    // to wake the loop. To keep those reads accurate we swap the deferred list
    // out before iterating so the field reflects only tasks still waiting, and
    // reload `active` from the atomic after every start rather than tracking
    // it locally.
    this.has_pending_queued_abort = false;
    {
        var pending = this.deferred_tasks;
        this.deferred_tasks = .{};
        defer pending.deinit(bun.default_allocator);
        for (pending.items) |http| {
            if (http.client.signals.get(.aborted) or active < max) {
                startQueuedTask(http);
                if (comptime Environment.allow_assert) count += 1;
                active = AsyncHTTP.active_requests_count.load(.monotonic);
            } else {
                bun.handleOom(this.deferred_tasks.append(bun.default_allocator, http));
            }
        }
    }

    while (this.queued_tasks.pop()) |http| {
        if (!http.client.signals.get(.aborted) and active >= max) {
            // Can't start this one yet. Defer it (preserves FIFO relative to
            // later pops) and keep draining — there may be aborted tasks
            // behind it that we can fail-fast right now.
            bun.handleOom(this.deferred_tasks.append(bun.default_allocator, http));
            continue;
        }
        startQueuedTask(http);
        if (comptime Environment.allow_assert) count += 1;
        active = AsyncHTTP.active_requests_count.load(.monotonic);
    }
}

fn startQueuedTask(http: *AsyncHTTP) void {
    var cloned = bun.http.ThreadlocalAsyncHTTP.new(.{
        .async_http = http.*,
    });
    cloned.async_http.real = http;
    // Clear stale queue pointers - the clone inherited http.next and http.task.node.next
    // which may point to other AsyncHTTP structs that could be freed before the callback
    // copies data back to the original. If not cleared, retrying a failed request would
    // re-queue with stale pointers causing use-after-free.
    cloned.async_http.next = null;
    cloned.async_http.task.node.next = null;
    cloned.async_http.onStart();
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
        if (comptime Environment.isDebug and bun.asan.enabled) {
            for (bun.http.socket_async_http_abort_tracker.keys(), bun.http.socket_async_http_abort_tracker.values()) |http_id, socket| {
                if (socket.socket().get()) |usocket| {
                    _ = http_id;
                    bun.asan.assertUnpoisoned(usocket);
                }
            }
        }

        var start_time: i128 = 0;
        if (comptime Environment.isDebug) {
            start_time = std.time.nanoTimestamp();
        }
        Output.flush();

        this.loop.loop.inc();
        this.loop.loop.tick();
        this.loop.loop.dec();

        if (comptime Environment.isDebug and bun.asan.enabled) {
            for (bun.http.socket_async_http_abort_tracker.keys(), bun.http.socket_async_http_abort_tracker.values()) |http_id, socket| {
                if (socket.socket().get()) |usocket| {
                    _ = http_id;
                    bun.asan.assertUnpoisoned(usocket);
                }
            }
        }

        // this.loop.run();
        if (comptime Environment.isDebug) {
            const end = std.time.nanoTimestamp();
            threadlog("Waited {D}\n", .{@as(i64, @truncate(end - start_time))});
            Output.flush();
        }
    }
}

pub fn scheduleResponseBodyDrain(this: *@This(), async_http_id: u32) void {
    {
        this.queued_response_body_drains_lock.lock();
        defer this.queued_response_body_drains_lock.unlock();
        this.queued_response_body_drains.append(bun.default_allocator, .{
            .async_http_id = async_http_id,
        }) catch |err| bun.handleOom(err);
    }
    if (this.has_awoken.load(.monotonic))
        this.loop.loop.wakeup();
}

pub fn scheduleShutdown(this: *@This(), http: *AsyncHTTP) void {
    threadlog("scheduleShutdown {d}", .{http.async_http_id});
    {
        this.queued_shutdowns_lock.lock();
        defer this.queued_shutdowns_lock.unlock();
        this.queued_shutdowns.append(bun.default_allocator, .{
            .async_http_id = http.async_http_id,
        }) catch |err| bun.handleOom(err);
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
            .message_type = messageType,
        }) catch |err| bun.handleOom(err);
    }
    if (this.has_awoken.load(.monotonic))
        this.loop.loop.wakeup();
}

pub fn scheduleProxyDeref(this: *@This(), proxy: *ProxyTunnel) void {
    // this is always called on the http thread,
    bun.handleOom(this.queued_threadlocal_proxy_derefs.append(bun.default_allocator, proxy));
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
const Arena = bun.allocators.MimallocArena;
const Batch = bun.ThreadPool.Batch;
const UnboundedQueue = bun.threading.UnboundedQueue;
const SSLConfig = bun.api.server.ServerConfig.SSLConfig;

const HTTPClient = bun.http;
const AsyncHTTP = bun.http.AsyncHTTP;
const InitError = HTTPClient.InitError;
const NewHTTPContext = bun.http.NewHTTPContext;
