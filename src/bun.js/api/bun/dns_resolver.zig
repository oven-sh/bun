const Bun = @This();
const default_allocator = bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;

const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const MutableString = bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const c_ares = bun.c_ares;
const Async = bun.Async;
const GetAddrInfoAsyncCallback = fn (i32, ?*std.c.addrinfo, ?*anyopaque) callconv(.C) void;
const INET6_ADDRSTRLEN = if (bun.Environment.isWindows) 65 else 46;
const IANA_DNS_PORT = 53;

const LibInfo = struct {
    // static int32_t (*getaddrinfo_async_start)(mach_port_t*,
    //                                           const char*,
    //                                           const char*,
    //                                           const struct addrinfo*,
    //                                           getaddrinfo_async_callback,
    //                                           void*);
    // static int32_t (*getaddrinfo_async_handle_reply)(void*);
    // static void (*getaddrinfo_async_cancel)(mach_port_t);
    // typedef void getaddrinfo_async_callback(int32_t, struct addrinfo*, void*)
    const GetaddrinfoAsyncStart = fn (*?*anyopaque, noalias node: ?[*:0]const u8, noalias service: ?[*:0]const u8, noalias hints: ?*const std.c.addrinfo, callback: *const GetAddrInfoAsyncCallback, noalias context: ?*anyopaque) callconv(.C) i32;
    const GetaddrinfoAsyncHandleReply = fn (?**anyopaque) callconv(.C) i32;
    const GetaddrinfoAsyncCancel = fn (?**anyopaque) callconv(.C) void;

    var handle: ?*anyopaque = null;
    var loaded = false;
    pub fn getHandle() ?*anyopaque {
        if (loaded)
            return handle;
        loaded = true;
        const RTLD_LAZY = 1;
        const RTLD_LOCAL = 4;

        handle = bun.C.dlopen("libinfo.dylib", RTLD_LAZY | RTLD_LOCAL);
        if (handle == null)
            Output.debug("libinfo.dylib not found", .{});
        return handle;
    }

    pub const getaddrinfo_async_start = struct {
        pub fn get() ?*const GetaddrinfoAsyncStart {
            bun.Environment.onlyMac();

            return bun.C.dlsymWithHandle(*const GetaddrinfoAsyncStart, "getaddrinfo_async_start", getHandle);
        }
    }.get;

    pub const getaddrinfo_async_handle_reply = struct {
        pub fn get() ?*const GetaddrinfoAsyncHandleReply {
            bun.Environment.onlyMac();

            return bun.C.dlsymWithHandle(*const GetaddrinfoAsyncHandleReply, "getaddrinfo_async_handle_reply", getHandle);
        }
    }.get;

    pub fn get() ?*const GetaddrinfoAsyncCancel {
        bun.Environment.onlyMac();

        return bun.C.dlsymWithHandle(*const GetaddrinfoAsyncCancel, "getaddrinfo_async_cancel", getHandle);
    }

    pub fn lookup(this: *DNSResolver, query: GetAddrInfo, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        bun.Environment.onlyMac();

        const getaddrinfo_async_start_ = LibInfo.getaddrinfo_async_start() orelse return LibC.lookup(this, query, globalThis);

        const key = GetAddrInfoRequest.PendingCacheKey.init(query);
        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_native);

        if (cache == .inflight) {
            var dns_lookup = DNSLookup.init(globalThis, globalThis.allocator()) catch bun.outOfMemory();

            cache.inflight.append(dns_lookup);

            return dns_lookup.promise.value();
        }

        var name_buf: [1024]u8 = undefined;
        _ = strings.copy(name_buf[0..], query.name);

        name_buf[query.name.len] = 0;
        const name_z = name_buf[0..query.name.len :0];

        var request = GetAddrInfoRequest.init(
            cache,
            .{ .libinfo = undefined },
            this,
            query,
            globalThis,
            "pending_host_cache_native",
        ) catch unreachable;
        const promise_value = request.head.promise.value();

        const hints = query.options.toLibC();
        const errno = getaddrinfo_async_start_(
            &request.backend.libinfo.machport,
            name_z.ptr,
            null,
            if (hints != null) &hints.? else null,
            GetAddrInfoRequest.getAddrInfoAsyncCallback,
            request,
        );

        if (errno != 0) {
            request.head.promise.rejectTask(globalThis, globalThis.createErrorInstance("getaddrinfo_async_start error: {s}", .{@tagName(bun.C.getErrno(errno))}));
            if (request.cache.pending_cache) this.pending_host_cache_native.available.set(request.cache.pos_in_pending);
            this.vm.allocator.destroy(request);

            return promise_value;
        }

        bun.assert(request.backend.libinfo.machport != null);
        var poll = bun.Async.FilePoll.init(this.vm, bun.toFD(std.math.maxInt(i32) - 1), .{}, GetAddrInfoRequest, request);
        request.backend.libinfo.file_poll = poll;
        const rc = poll.registerWithFd(
            this.vm.event_loop_handle.?,
            .machport,
            .one_shot,
            bun.toFD(@as(i32, @intCast(@intFromPtr(request.backend.libinfo.machport)))),
        );
        bun.assert(rc == .result);

        poll.enableKeepingProcessAlive(this.vm.eventLoop());

        return promise_value;
    }
};

const LibC = struct {
    pub fn lookup(this: *DNSResolver, query_init: GetAddrInfo, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        if (Environment.isWindows) {
            @compileError("Do not use this path on Windows");
        }
        const key = GetAddrInfoRequest.PendingCacheKey.init(query_init);

        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_native);
        if (cache == .inflight) {
            var dns_lookup = DNSLookup.init(globalThis, globalThis.allocator()) catch unreachable;

            cache.inflight.append(dns_lookup);

            return dns_lookup.promise.value();
        }

        const query = query_init.clone();

        var request = GetAddrInfoRequest.init(
            cache,
            .{
                .libc = .{
                    .query = query,
                },
            },
            this,
            query,
            globalThis,
            "pending_host_cache_native",
        ) catch unreachable;
        const promise_value = request.head.promise.value();

        var io = GetAddrInfoRequest.Task.createOnJSThread(this.vm.allocator, globalThis, request) catch unreachable;

        io.schedule();

        return promise_value;
    }
};

const libuv = bun.windows.libuv;

/// The windows implementation borrows the struct used for libc getaddrinfo
const LibUVBackend = struct {
    const log = Output.scoped(.LibUVBackend, false);

    fn onRawLibUVComplete(uv_info: *libuv.uv_getaddrinfo_t, _: c_int, _: ?*libuv.addrinfo) callconv(.C) void {
        //TODO: We schedule a task to run because otherwise the promise will not be solved, we need to investigate this
        const this: *GetAddrInfoRequest = @alignCast(@ptrCast(uv_info.data));
        const Holder = struct {
            uv_info: *libuv.uv_getaddrinfo_t,
            task: JSC.AnyTask,

            pub fn run(held: *@This()) void {
                defer bun.default_allocator.destroy(held);
                GetAddrInfoRequest.onLibUVComplete(held.uv_info);
            }
        };

        var holder = bun.default_allocator.create(Holder) catch unreachable;
        holder.* = .{
            .uv_info = uv_info,
            .task = undefined,
        };
        holder.task = JSC.AnyTask.New(Holder, Holder.run).init(holder);

        this.head.globalThis.bunVM().enqueueTask(JSC.Task.init(&holder.task));
    }

    pub fn lookup(this: *DNSResolver, query: GetAddrInfo, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const key = GetAddrInfoRequest.PendingCacheKey.init(query);

        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_native);
        if (cache == .inflight) {
            var dns_lookup = DNSLookup.init(globalThis, globalThis.allocator()) catch bun.outOfMemory();

            cache.inflight.append(dns_lookup);

            return dns_lookup.promise.value();
        }

        var request = GetAddrInfoRequest.init(
            cache,
            .{
                .libc = .{
                    .uv = undefined,
                },
            },
            this,
            query,
            globalThis,
            "pending_host_cache_native",
        ) catch bun.outOfMemory();

        var hints = query.options.toLibC();
        var port_buf: [128]u8 = undefined;
        const port = std.fmt.bufPrintIntToSlice(&port_buf, query.port, 10, .lower, .{});
        port_buf[port.len] = 0;
        const portZ = port_buf[0..port.len :0];
        var hostname: bun.PathBuffer = undefined;
        _ = strings.copy(hostname[0..], query.name);
        hostname[query.name.len] = 0;
        const host = hostname[0..query.name.len :0];

        request.backend.libc.uv.data = request;
        const promise = request.head.promise.value();
        if (libuv.uv_getaddrinfo(
            this.vm.uvLoop(),
            &request.backend.libc.uv,
            &onRawLibUVComplete,
            host.ptr,
            portZ.ptr,
            if (hints) |*hint| hint else null,
        ).errEnum()) |_| {
            @panic("TODO: handle error");
        }
        return promise;
    }
};

const GetAddrInfo = bun.dns.GetAddrInfo;

pub fn normalizeDNSName(name: []const u8, backend: *GetAddrInfo.Backend) []const u8 {
    if (backend.* == .c_ares) {
        // https://github.com/c-ares/c-ares/issues/477
        if (strings.endsWithComptime(name, ".localhost")) {
            backend.* = .system;
            return "localhost";
        } else if (strings.endsWithComptime(name, ".local")) {
            backend.* = .system;
            // https://github.com/c-ares/c-ares/pull/463
        } else if (strings.isIPV6Address(name)) {
            backend.* = .system;
        }
        // getaddrinfo() is inconsistent with ares_getaddrinfo() when using localhost
        else if (strings.eqlComptime(name, "localhost")) {
            backend.* = .system;
        }
    }

    return name;
}

pub fn ResolveInfoRequest(comptime cares_type: type, comptime type_name: []const u8) type {
    return struct {
        const request_type = @This();

        const log = Output.scoped(.ResolveInfoRequest, true);

        resolver_for_caching: ?*DNSResolver = null,
        hash: u64 = 0,
        cache: @This().CacheConfig = @This().CacheConfig{},
        head: CAresLookup(cares_type, type_name),
        tail: *CAresLookup(cares_type, type_name) = undefined,

        pub fn init(
            cache: DNSResolver.LookupCacheHit(@This()),
            resolver: ?*DNSResolver,
            name: []const u8,
            globalThis: *JSC.JSGlobalObject,
            comptime cache_field: []const u8,
        ) !*@This() {
            var request = try globalThis.allocator().create(@This());
            var hasher = std.hash.Wyhash.init(0);
            hasher.update(name);
            const hash = hasher.final();
            var poll_ref = Async.KeepAlive.init();
            poll_ref.ref(globalThis.bunVM());
            request.* = .{
                .resolver_for_caching = resolver,
                .hash = hash,
                .head = .{ .poll_ref = poll_ref, .globalThis = globalThis, .promise = JSC.JSPromise.Strong.init(globalThis), .allocated = false, .name = name },
            };
            request.tail = &request.head;
            if (cache == .new) {
                request.resolver_for_caching = resolver;
                request.cache = @This().CacheConfig{
                    .pending_cache = true,
                    .entry_cache = false,
                    .pos_in_pending = @as(u5, @truncate(@field(resolver.?, cache_field).indexOf(cache.new).?)),
                    .name_len = @as(u9, @truncate(name.len)),
                };
                cache.new.lookup = request;
            }
            return request;
        }

        pub const CacheConfig = packed struct(u16) {
            pending_cache: bool = false,
            entry_cache: bool = false,
            pos_in_pending: u5 = 0,
            name_len: u9 = 0,
        };

        pub const PendingCacheKey = struct {
            hash: u64,
            len: u16,
            lookup: *request_type = undefined,

            pub fn append(this: *PendingCacheKey, cares_lookup: *CAresLookup(cares_type, type_name)) void {
                var tail = this.lookup.tail;
                tail.next = cares_lookup;
                this.lookup.tail = cares_lookup;
            }

            pub fn init(name: []const u8) PendingCacheKey {
                var hasher = std.hash.Wyhash.init(0);
                hasher.update(name);
                const hash = hasher.final();
                return PendingCacheKey{
                    .hash = hash,
                    .len = @as(u16, @truncate(name.len)),
                    .lookup = undefined,
                };
            }
        };

        pub fn onCaresComplete(this: *@This(), err_: ?c_ares.Error, timeout: i32, result: ?*cares_type) void {
            if (this.resolver_for_caching) |resolver| {
                if (this.cache.pending_cache) {
                    resolver.drainPendingCares(
                        this.cache.pos_in_pending,
                        err_,
                        timeout,
                        @This(),
                        cares_type,
                        type_name,
                        result,
                    );
                    return;
                }
            }

            var head = this.head;
            bun.default_allocator.destroy(this);

            head.processResolve(err_, timeout, result);
        }
    };
}

pub const GetHostByAddrInfoRequest = struct {
    const request_type = @This();

    const log = Output.scoped(@This(), false);

    resolver_for_caching: ?*DNSResolver = null,
    hash: u64 = 0,
    cache: @This().CacheConfig = @This().CacheConfig{},
    head: CAresReverse,
    tail: *CAresReverse = undefined,

    pub fn init(
        cache: DNSResolver.LookupCacheHit(@This()),
        resolver: ?*DNSResolver,
        name: []const u8,
        globalThis: *JSC.JSGlobalObject,
        comptime cache_field: []const u8,
    ) !*@This() {
        var request = try globalThis.allocator().create(@This());
        var hasher = std.hash.Wyhash.init(0);
        hasher.update(name);
        const hash = hasher.final();
        var poll_ref = Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());
        request.* = .{
            .resolver_for_caching = resolver,
            .hash = hash,
            .head = .{ .poll_ref = poll_ref, .globalThis = globalThis, .promise = JSC.JSPromise.Strong.init(globalThis), .allocated = false, .name = name },
        };
        request.tail = &request.head;
        if (cache == .new) {
            request.resolver_for_caching = resolver;
            request.cache = @This().CacheConfig{
                .pending_cache = true,
                .entry_cache = false,
                .pos_in_pending = @as(u5, @truncate(@field(resolver.?, cache_field).indexOf(cache.new).?)),
                .name_len = @as(u9, @truncate(name.len)),
            };
            cache.new.lookup = request;
        }
        return request;
    }

    pub const CacheConfig = packed struct(u16) {
        pending_cache: bool = false,
        entry_cache: bool = false,
        pos_in_pending: u5 = 0,
        name_len: u9 = 0,
    };

    pub const PendingCacheKey = struct {
        hash: u64,
        len: u16,
        lookup: *request_type = undefined,

        pub fn append(this: *PendingCacheKey, cares_lookup: *CAresReverse) void {
            var tail = this.lookup.tail;
            tail.next = cares_lookup;
            this.lookup.tail = cares_lookup;
        }

        pub fn init(name: []const u8) PendingCacheKey {
            var hasher = std.hash.Wyhash.init(0);
            hasher.update(name);
            const hash = hasher.final();
            return PendingCacheKey{
                .hash = hash,
                .len = @as(u16, @truncate(name.len)),
                .lookup = undefined,
            };
        }
    };

    pub fn onCaresComplete(this: *@This(), err_: ?c_ares.Error, timeout: i32, result: ?*c_ares.struct_hostent) void {
        if (this.resolver_for_caching) |resolver| {
            if (this.cache.pending_cache) {
                resolver.drainPendingAddrCares(
                    this.cache.pos_in_pending,
                    err_,
                    timeout,
                    result,
                );
                return;
            }
        }

        var head = this.head;
        bun.default_allocator.destroy(this);

        head.processResolve(err_, timeout, result);
    }
};

pub const CAresNameInfo = struct {
    const log = Output.scoped(.CAresNameInfo, true);

    globalThis: *JSC.JSGlobalObject = undefined,
    promise: JSC.JSPromise.Strong,
    poll_ref: bun.Async.KeepAlive,
    allocated: bool = false,
    next: ?*@This() = null,
    name: []const u8,

    pub fn init(globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator, name: []const u8) !*@This() {
        const this = try allocator.create(@This());
        var poll_ref = bun.Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());
        this.* = .{ .globalThis = globalThis, .promise = JSC.JSPromise.Strong.init(globalThis), .poll_ref = poll_ref, .allocated = true, .name = name };
        return this;
    }

    pub fn processResolve(this: *@This(), err_: ?c_ares.Error, _: i32, result: ?c_ares.struct_nameinfo) void {
        if (err_) |err| {
            var promise = this.promise;
            const globalThis = this.globalThis;
            promise.rejectTask(globalThis, err.toJS(globalThis));
            this.deinit();
            return;
        }
        if (result == null) {
            var promise = this.promise;
            const globalThis = this.globalThis;
            promise.rejectTask(globalThis, c_ares.Error.ENOTFOUND.toJS(globalThis));
            this.deinit();
            return;
        }
        var name_info = result.?;
        const array = name_info.toJSResponse(this.globalThis.allocator(), this.globalThis);
        this.onComplete(array);
        return;
    }

    pub fn onComplete(this: *@This(), result: JSC.JSValue) void {
        var promise = this.promise;
        const globalThis = this.globalThis;
        this.promise = .{};
        promise.resolveTask(globalThis, result);
        this.deinit();
    }

    pub fn deinit(this: *@This()) void {
        this.poll_ref.unref(this.globalThis.bunVM());
        // freed
        bun.default_allocator.free(this.name);

        if (this.allocated)
            this.globalThis.allocator().destroy(this);
    }
};

pub const GetNameInfoRequest = struct {
    const request_type = @This();

    const log = Output.scoped(@This(), false);

    resolver_for_caching: ?*DNSResolver = null,
    hash: u64 = 0,
    cache: @This().CacheConfig = @This().CacheConfig{},
    head: CAresNameInfo,
    tail: *CAresNameInfo = undefined,

    pub fn init(
        cache: DNSResolver.LookupCacheHit(@This()),
        resolver: ?*DNSResolver,
        name: []const u8,
        globalThis: *JSC.JSGlobalObject,
        comptime cache_field: []const u8,
    ) !*@This() {
        var request = try globalThis.allocator().create(@This());
        var hasher = std.hash.Wyhash.init(0);
        hasher.update(name);
        const hash = hasher.final();
        var poll_ref = bun.Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());
        request.* = .{
            .resolver_for_caching = resolver,
            .hash = hash,
            .head = .{ .poll_ref = poll_ref, .globalThis = globalThis, .promise = JSC.JSPromise.Strong.init(globalThis), .allocated = false, .name = name },
        };
        request.tail = &request.head;
        if (cache == .new) {
            request.resolver_for_caching = resolver;
            request.cache = @This().CacheConfig{
                .pending_cache = true,
                .entry_cache = false,
                .pos_in_pending = @as(u5, @truncate(@field(resolver.?, cache_field).indexOf(cache.new).?)),
                .name_len = @as(u9, @truncate(name.len)),
            };
            cache.new.lookup = request;
        }
        return request;
    }

    pub const CacheConfig = packed struct(u16) {
        pending_cache: bool = false,
        entry_cache: bool = false,
        pos_in_pending: u5 = 0,
        name_len: u9 = 0,
    };

    pub const PendingCacheKey = struct {
        hash: u64,
        len: u16,
        lookup: *request_type = undefined,

        pub fn append(this: *PendingCacheKey, cares_lookup: *CAresNameInfo) void {
            var tail = this.lookup.tail;
            tail.next = cares_lookup;
            this.lookup.tail = cares_lookup;
        }

        pub fn init(name: []const u8) PendingCacheKey {
            var hasher = std.hash.Wyhash.init(0);
            hasher.update(name);
            const hash = hasher.final();
            return PendingCacheKey{
                .hash = hash,
                .len = @as(u16, @truncate(name.len)),
                .lookup = undefined,
            };
        }
    };

    pub fn onCaresComplete(this: *@This(), err_: ?c_ares.Error, timeout: i32, result: ?c_ares.struct_nameinfo) void {
        if (this.resolver_for_caching) |resolver| {
            if (this.cache.pending_cache) {
                resolver.drainPendingNameInfoCares(
                    this.cache.pos_in_pending,
                    err_,
                    timeout,
                    result,
                );
                return;
            }
        }

        var head = this.head;
        bun.default_allocator.destroy(this);

        head.processResolve(err_, timeout, result);
    }
};

pub const GetAddrInfoRequest = struct {
    const log = Output.scoped(.GetAddrInfoRequest, false);

    backend: Backend = undefined,
    resolver_for_caching: ?*DNSResolver = null,
    hash: u64 = 0,
    cache: CacheConfig = CacheConfig{},
    head: DNSLookup,
    tail: *DNSLookup = undefined,
    task: bun.ThreadPool.Task = undefined,

    pub fn init(
        cache: DNSResolver.CacheHit,
        backend: Backend,
        resolver: ?*DNSResolver,
        query: GetAddrInfo,
        globalThis: *JSC.JSGlobalObject,
        comptime cache_field: []const u8,
    ) !*GetAddrInfoRequest {
        log("init", .{});
        var request = try globalThis.allocator().create(GetAddrInfoRequest);
        var poll_ref = Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());
        request.* = .{
            .backend = backend,
            .resolver_for_caching = resolver,
            .hash = query.hash(),
            .head = .{
                .globalThis = globalThis,
                .poll_ref = poll_ref,
                .promise = JSC.JSPromise.Strong.init(globalThis),
                .allocated = false,
            },
        };
        request.tail = &request.head;
        if (cache == .new) {
            request.resolver_for_caching = resolver;
            request.cache = CacheConfig{
                .pending_cache = true,
                .entry_cache = false,
                .pos_in_pending = @as(u5, @truncate(@field(resolver.?, cache_field).indexOf(cache.new).?)),
                .name_len = @as(u9, @truncate(query.name.len)),
            };
            cache.new.lookup = request;
        }
        return request;
    }

    pub const Task = bun.JSC.WorkTask(GetAddrInfoRequest);

    pub const CacheConfig = packed struct(u16) {
        pending_cache: bool = false,
        entry_cache: bool = false,
        pos_in_pending: u5 = 0,
        name_len: u9 = 0,
    };

    pub const PendingCacheKey = struct {
        hash: u64,
        len: u16,
        lookup: *GetAddrInfoRequest = undefined,

        pub fn append(this: *PendingCacheKey, dns_lookup: *DNSLookup) void {
            var tail = this.lookup.tail;
            tail.next = dns_lookup;
            this.lookup.tail = dns_lookup;
        }

        pub fn init(query: GetAddrInfo) PendingCacheKey {
            return PendingCacheKey{
                .hash = query.hash(),
                .len = @as(u16, @truncate(query.name.len)),
                .lookup = undefined,
            };
        }
    };

    pub fn getAddrInfoAsyncCallback(
        status: i32,
        addr_info: ?*std.c.addrinfo,
        arg: ?*anyopaque,
    ) callconv(.C) void {
        const this = @as(*GetAddrInfoRequest, @ptrCast(@alignCast(arg)));
        log("getAddrInfoAsyncCallback: status={d}", .{status});

        if (this.backend == .libinfo) {
            if (this.backend.libinfo.file_poll) |poll| poll.deinit();
        }

        if (this.resolver_for_caching) |resolver| {
            if (this.cache.pending_cache) {
                resolver.drainPendingHostNative(this.cache.pos_in_pending, this.head.globalThis, status, .{ .addrinfo = addr_info });
                return;
            }
        }

        var head = this.head;
        bun.default_allocator.destroy(this);
        head.processGetAddrInfoNative(status, addr_info);
    }

    pub const Backend = union(enum) {
        c_ares: void,
        libinfo: GetAddrInfoRequest.Backend.LibInfo,
        libc: if (Environment.isWindows)
            struct {
                uv: libuv.uv_getaddrinfo_t = undefined,

                pub fn run(_: *@This()) void {
                    @panic("This path should never be reached on Windows");
                }
            }
        else
            union(enum) {
                success: GetAddrInfo.Result.List,
                err: i32,
                query: GetAddrInfo,

                pub fn run(this: *@This()) void {
                    const query = this.query;
                    defer bun.default_allocator.free(@constCast(query.name));
                    var hints = query.options.toLibC();
                    var port_buf: [128]u8 = undefined;
                    const port = std.fmt.bufPrintIntToSlice(&port_buf, query.port, 10, .lower, .{});
                    port_buf[port.len] = 0;
                    const portZ = port_buf[0..port.len :0];
                    var hostname: bun.PathBuffer = undefined;
                    _ = strings.copy(hostname[0..], query.name);
                    hostname[query.name.len] = 0;
                    var addrinfo: ?*std.c.addrinfo = null;
                    const host = hostname[0..query.name.len :0];
                    const debug_timer = bun.Output.DebugTimer.start();
                    const err = std.c.getaddrinfo(
                        host.ptr,
                        if (port.len > 0) portZ.ptr else null,
                        if (hints) |*hint| hint else null,
                        &addrinfo,
                    );
                    bun.sys.syslog("getaddrinfo({s}, {d}) = {d} ({any})", .{
                        query.name,
                        port,
                        err,
                        debug_timer,
                    });
                    if (@intFromEnum(err) != 0 or addrinfo == null) {
                        this.* = .{ .err = @intFromEnum(err) };
                        return;
                    }

                    // do not free addrinfo when err != 0
                    // https://github.com/ziglang/zig/pull/14242
                    defer std.c.freeaddrinfo(addrinfo.?);

                    this.* = .{ .success = GetAddrInfo.Result.toList(default_allocator, addrinfo.?) catch unreachable };
                }
            },

        pub const LibInfo = struct {
            file_poll: ?*bun.Async.FilePoll = null,
            machport: ?*anyopaque = null,

            extern fn getaddrinfo_send_reply(*anyopaque, *const JSC.DNS.LibInfo.GetaddrinfoAsyncHandleReply) bool;
            pub fn onMachportChange(this: *GetAddrInfoRequest) void {
                if (comptime !Environment.isMac)
                    unreachable;
                bun.JSC.markBinding(@src());

                if (!getaddrinfo_send_reply(this.backend.libinfo.machport.?, JSC.DNS.LibInfo.getaddrinfo_async_handle_reply().?)) {
                    log("onMachportChange: getaddrinfo_send_reply failed", .{});
                    getAddrInfoAsyncCallback(-1, null, this);
                }
            }
        };
    };

    pub const onMachportChange = Backend.LibInfo.onMachportChange;

    pub fn run(this: *GetAddrInfoRequest, task: *Task) void {
        this.backend.libc.run();
        task.onFinish();
    }

    pub fn then(this: *GetAddrInfoRequest, _: *JSC.JSGlobalObject) void {
        log("then", .{});
        switch (this.backend.libc) {
            .success => |result| {
                const any = GetAddrInfo.Result.Any{ .list = result };
                defer any.deinit();
                if (this.resolver_for_caching) |resolver| {
                    // if (this.cache.entry_cache and result != null and result.?.node != null) {
                    //     resolver.putEntryInCache(this.hash, this.cache.name_len, result.?);
                    // }

                    if (this.cache.pending_cache) {
                        resolver.drainPendingHostNative(this.cache.pos_in_pending, this.head.globalThis, 0, any);
                        return;
                    }
                }
                var head = this.head;
                bun.default_allocator.destroy(this);
                head.onCompleteNative(any);
            },
            .err => |err| {
                getAddrInfoAsyncCallback(err, null, this);
            },
            else => unreachable,
        }
    }

    pub fn onCaresComplete(this: *GetAddrInfoRequest, err_: ?c_ares.Error, timeout: i32, result: ?*c_ares.AddrInfo) void {
        log("onCaresComplete", .{});
        if (this.resolver_for_caching) |resolver| {
            // if (this.cache.entry_cache and result != null and result.?.node != null) {
            //     resolver.putEntryInCache(this.hash, this.cache.name_len, result.?);
            // }

            if (this.cache.pending_cache) {
                resolver.drainPendingHostCares(
                    this.cache.pos_in_pending,
                    err_,
                    timeout,
                    result,
                );
                return;
            }
        }

        var head = this.head;
        bun.default_allocator.destroy(this);

        head.processGetAddrInfo(err_, timeout, result);
    }

    pub fn onLibUVComplete(uv_info: *libuv.uv_getaddrinfo_t) void {
        log("onLibUVComplete: status={d}", .{uv_info.retcode.int()});
        const this: *GetAddrInfoRequest = @alignCast(@ptrCast(uv_info.data));
        bun.assert(uv_info == &this.backend.libc.uv);
        if (this.backend == .libinfo) {
            if (this.backend.libinfo.file_poll) |poll| poll.deinit();
        }

        if (this.resolver_for_caching) |resolver| {
            if (this.cache.pending_cache) {
                resolver.drainPendingHostNative(this.cache.pos_in_pending, this.head.globalThis, uv_info.retcode.int(), .{ .addrinfo = uv_info.addrinfo });
                return;
            }
        }

        var head = this.head;
        head.processGetAddrInfoNative(uv_info.retcode.int(), uv_info.addrinfo);
        head.globalThis.allocator().destroy(this);
    }
};

pub const CAresReverse = struct {
    const log = Output.scoped(.CAresReverse, false);

    globalThis: *JSC.JSGlobalObject = undefined,
    promise: JSC.JSPromise.Strong,
    poll_ref: Async.KeepAlive,
    allocated: bool = false,
    next: ?*@This() = null,
    name: []const u8,

    pub fn init(globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator, name: []const u8) !*@This() {
        const this = try allocator.create(@This());
        var poll_ref = Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());
        this.* = .{ .globalThis = globalThis, .promise = JSC.JSPromise.Strong.init(globalThis), .poll_ref = poll_ref, .allocated = true, .name = name };
        return this;
    }

    pub fn processResolve(this: *@This(), err_: ?c_ares.Error, _: i32, result: ?*c_ares.struct_hostent) void {
        if (err_) |err| {
            var promise = this.promise;
            const globalThis = this.globalThis;
            promise.rejectTask(globalThis, err.toJS(globalThis));
            this.deinit();
            return;
        }
        if (result == null) {
            var promise = this.promise;
            const globalThis = this.globalThis;
            promise.rejectTask(globalThis, c_ares.Error.ENOTFOUND.toJS(globalThis));
            this.deinit();
            return;
        }
        var node = result.?;
        const array = node.toJSResponse(this.globalThis.allocator(), this.globalThis, "");
        this.onComplete(array);
        return;
    }

    pub fn onComplete(this: *@This(), result: JSC.JSValue) void {
        var promise = this.promise;
        const globalThis = this.globalThis;
        this.promise = .{};
        promise.resolveTask(globalThis, result);
        this.deinit();
    }

    pub fn deinit(this: *@This()) void {
        this.poll_ref.unref(this.globalThis.bunVM());
        bun.default_allocator.free(this.name);

        if (this.allocated)
            this.globalThis.allocator().destroy(this);
    }
};

pub fn CAresLookup(comptime cares_type: type, comptime type_name: []const u8) type {
    return struct {
        const log = Output.scoped(.CAresLookup, true);

        globalThis: *JSC.JSGlobalObject = undefined,
        promise: JSC.JSPromise.Strong,
        poll_ref: Async.KeepAlive,
        allocated: bool = false,
        next: ?*@This() = null,
        name: []const u8,

        pub usingnamespace bun.New(@This());

        pub fn init(globalThis: *JSC.JSGlobalObject, _: std.mem.Allocator, name: []const u8) !*@This() {
            var poll_ref = Async.KeepAlive.init();
            poll_ref.ref(globalThis.bunVM());
            return @This().new(
                .{
                    .globalThis = globalThis,
                    .promise = JSC.JSPromise.Strong.init(globalThis),
                    .poll_ref = poll_ref,
                    .allocated = true,
                    .name = name,
                },
            );
        }

        pub fn processResolve(this: *@This(), err_: ?c_ares.Error, _: i32, result: ?*cares_type) void {
            if (err_) |err| {
                var promise = this.promise;
                const globalThis = this.globalThis;
                promise.rejectTask(globalThis, err.toJS(globalThis));
                this.deinit();
                return;
            }
            if (result == null) {
                var promise = this.promise;
                const globalThis = this.globalThis;
                promise.rejectTask(globalThis, c_ares.Error.ENOTFOUND.toJS(globalThis));
                this.deinit();
                return;
            }

            var node = result.?;
            const array = node.toJSResponse(this.globalThis.allocator(), this.globalThis, type_name);
            this.onComplete(array);
            return;
        }

        pub fn onComplete(this: *@This(), result: JSC.JSValue) void {
            var promise = this.promise;
            const globalThis = this.globalThis;
            this.promise = .{};
            promise.resolveTask(globalThis, result);
            this.deinit();
        }

        pub fn deinit(this: *@This()) void {
            this.poll_ref.unref(this.globalThis.bunVM());
            bun.default_allocator.free(this.name);

            if (this.allocated)
                this.destroy();
        }
    };
}

pub const DNSLookup = struct {
    const log = Output.scoped(.DNSLookup, false);

    globalThis: *JSC.JSGlobalObject = undefined,
    promise: JSC.JSPromise.Strong,
    allocated: bool = false,
    next: ?*DNSLookup = null,
    poll_ref: Async.KeepAlive,

    pub fn init(globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator) !*DNSLookup {
        log("init", .{});

        const this = try allocator.create(DNSLookup);
        var poll_ref = Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());

        this.* = .{
            .globalThis = globalThis,
            .poll_ref = poll_ref,
            .promise = JSC.JSPromise.Strong.init(globalThis),
            .allocated = true,
        };
        return this;
    }

    pub fn onCompleteNative(this: *DNSLookup, result: GetAddrInfo.Result.Any) void {
        log("onCompleteNative", .{});
        const array = result.toJS(this.globalThis).?;
        this.onCompleteWithArray(array);
    }

    pub fn processGetAddrInfoNative(this: *DNSLookup, status: i32, result: ?*std.c.addrinfo) void {
        log("processGetAddrInfoNative: status={d}", .{status});
        if (c_ares.Error.initEAI(status)) |err| {
            var promise = this.promise;
            const globalThis = this.globalThis;

            const error_value = brk: {
                if (err == .ESERVFAIL) {
                    break :brk bun.sys.Error.fromCode(bun.C.getErrno(@as(c_int, -1)), .getaddrinfo).toJSC(globalThis);
                }

                break :brk err.toJS(globalThis);
            };

            this.deinit();
            promise.rejectTask(globalThis, error_value);
            return;
        }
        onCompleteNative(this, .{ .addrinfo = result });
    }

    pub fn processGetAddrInfo(this: *DNSLookup, err_: ?c_ares.Error, _: i32, result: ?*c_ares.AddrInfo) void {
        log("processGetAddrInfo", .{});
        if (err_) |err| {
            var promise = this.promise;
            const globalThis = this.globalThis;
            promise.rejectTask(globalThis, err.toJS(globalThis));
            this.deinit();
            return;
        }

        if (result == null or result.?.node == null) {
            var promise = this.promise;
            const globalThis = this.globalThis;

            const error_value = c_ares.Error.ENOTFOUND.toJS(globalThis);
            promise.rejectTask(globalThis, error_value);
            this.deinit();
            return;
        }
        this.onComplete(result.?);
    }

    pub fn onComplete(this: *DNSLookup, result: *c_ares.AddrInfo) void {
        log("onComplete", .{});

        const array = result.toJSArray(this.globalThis);
        this.onCompleteWithArray(array);
    }

    pub fn onCompleteWithArray(this: *DNSLookup, result: JSC.JSValue) void {
        log("onCompleteWithArray", .{});

        var promise = this.promise;
        this.promise = .{};
        const globalThis = this.globalThis;
        promise.resolveTask(globalThis, result);
        this.deinit();
    }

    pub fn deinit(this: *DNSLookup) void {
        log("deinit", .{});
        this.poll_ref.unref(this.globalThis.bunVM());

        if (this.allocated)
            this.globalThis.allocator().destroy(this);
    }
};

pub const GlobalData = struct {
    resolver: DNSResolver,

    pub fn init(allocator: std.mem.Allocator, vm: *JSC.VirtualMachine) *GlobalData {
        const global = allocator.create(GlobalData) catch unreachable;
        global.* = .{
            .resolver = .{
                .vm = vm,
                .polls = DNSResolver.PollsMap.init(allocator),
            },
        };

        return global;
    }
};

pub const InternalDNS = struct {
    const log = Output.scoped(.dns, true);

    var __max_dns_time_to_live_seconds: ?u32 = null;
    pub fn getMaxDNSTimeToLiveSeconds() u32 {
        // Amazon Web Services recommends 5 seconds: https://docs.aws.amazon.com/sdk-for-java/v1/developer-guide/jvm-ttl-dns.html
        const default_max_dns_time_to_live_seconds = 30;

        // This is racy, but it's okay because the number won't be invalid, just stale.
        return __max_dns_time_to_live_seconds orelse {
            if (bun.getenvZ("BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS")) |string_value| {
                const value = std.fmt.parseInt(i64, string_value, 10) catch {
                    __max_dns_time_to_live_seconds = default_max_dns_time_to_live_seconds;
                    return default_max_dns_time_to_live_seconds;
                };
                if (value < 0) {
                    __max_dns_time_to_live_seconds = std.math.maxInt(u32);
                } else {
                    __max_dns_time_to_live_seconds = @truncate(@as(u64, @intCast(value)));
                }
                return __max_dns_time_to_live_seconds.?;
            }

            __max_dns_time_to_live_seconds = default_max_dns_time_to_live_seconds;
            return default_max_dns_time_to_live_seconds;
        };
    }

    pub const Request = struct {
        pub usingnamespace bun.New(@This());
        const Key = struct {
            host: ?[:0]const u8,
            hash: u64,

            pub fn init(name: ?[:0]const u8) @This() {
                const hash = if (name) |n| brk: {
                    break :brk bun.hash(n);
                } else 0;
                return .{
                    .host = name,
                    .hash = hash,
                };
            }

            pub fn toOwned(this: @This()) @This() {
                if (this.host) |host| {
                    const host_copy = bun.default_allocator.dupeZ(u8, host) catch bun.outOfMemory();
                    return .{
                        .host = host_copy,
                        .hash = this.hash,
                    };
                } else {
                    return this;
                }
            }
        };

        const Result = extern struct {
            info: ?[*]ResultEntry,
            err: c_int,
        };

        pub const MacAsyncDNS = struct {
            file_poll: ?*bun.Async.FilePoll = null,
            machport: ?*anyopaque = null,

            extern fn getaddrinfo_send_reply(*anyopaque, *const JSC.DNS.LibInfo.GetaddrinfoAsyncHandleReply) bool;
            pub fn onMachportChange(this: *Request) void {
                if (!getaddrinfo_send_reply(this.libinfo.machport.?, LibInfo.getaddrinfo_async_handle_reply().?)) {
                    libinfoCallback(@intFromEnum(std.c.E.NOSYS), null, this);
                }
            }
        };

        key: Key,
        result: ?Result = null,

        notify: std.ArrayListUnmanaged(DNSRequestOwner) = .{},

        /// number of sockets that have a reference to result or are waiting for the result
        /// while this is non-zero, this entry cannot be freed
        refcount: u32 = 0,

        /// Seconds since the epoch when this request was created.
        /// Not a precise timestamp.
        created_at: u32 = std.math.maxInt(u32),

        valid: bool = true,

        libinfo: if (Environment.isMac) MacAsyncDNS else void = if (Environment.isMac) .{} else {},

        pub fn isExpired(this: *Request, timestamp_to_store: *u32) bool {
            if (this.refcount > 0 or this.result == null) {
                return false;
            }

            const now = if (timestamp_to_store.* == 0) GlobalCache.getCacheTimestamp() else timestamp_to_store.*;
            timestamp_to_store.* = now;

            if (now -| this.created_at > getMaxDNSTimeToLiveSeconds()) {
                this.valid = false;
                return true;
            }

            return false;
        }

        pub fn deinit(this: *@This()) void {
            bun.assert(this.notify.items.len == 0);
            if (this.result) |res| {
                if (res.info) |info| {
                    bun.default_allocator.destroy(&info[0]);
                }
            }
            if (this.key.host) |host| {
                bun.default_allocator.free(host);
            }

            this.destroy();
        }
    };

    const GlobalCache = struct {
        const MAX_ENTRIES = 256;

        lock: bun.Lock = bun.Lock.init(),
        cache: [MAX_ENTRIES]*Request = undefined,
        len: usize = 0,

        const This = @This();

        const CacheResult = union(enum) {
            inflight: *Request,
            resolved: *Request,
            none,
        };

        fn get(
            this: *This,
            key: Request.Key,
            timestamp_to_store: *u32,
        ) ?*Request {
            var len = this.len;
            var i: usize = 0;
            while (i < len) {
                var entry = this.cache[i];
                if (entry.key.hash == key.hash and entry.valid) {
                    if (entry.isExpired(timestamp_to_store)) {
                        log("get: expired entry", .{});
                        _ = this.deleteEntryAt(len, i);
                        entry.deinit();
                        len = this.len;
                        continue;
                    }

                    return entry;
                }

                i += 1;
            }

            return null;
        }

        // To preserve memory, we use a 32 bit timestamp
        // However, we're almost out of time to use 32 bit timestamps for anything
        // So we set the epoch to January 1st, 2024 instead.
        pub fn getCacheTimestamp() u32 {
            return @truncate(bun.getRoughTickCountMs() / 1000);
        }

        fn isNearlyFull(this: *This) bool {
            // 80% full (value is kind of arbitrary)
            return @atomicLoad(usize, &this.len, .monotonic) * 5 >= this.cache.len * 4;
        }

        fn deleteEntryAt(this: *This, len: usize, i: usize) ?*Request {
            this.len -= 1;
            dns_cache_size = len - 1;

            if (len > 1) {
                const prev = this.cache[len - 1];
                this.cache[i] = prev;
                return prev;
            }

            return null;
        }

        fn remove(this: *This, entry: *Request) void {
            const len = this.len;
            // equivalent of swapRemove
            for (0..len) |i| {
                if (this.cache[i] == entry) {
                    _ = this.deleteEntryAt(len, i);
                    return;
                }
            }
        }

        fn tryPush(this: *This, entry: *Request) bool {
            // is the cache full?
            if (this.len >= this.cache.len) {
                // check if there is an element to evict
                for (this.cache[0..this.len]) |*e| {
                    if (e.*.refcount == 0) {
                        e.*.deinit();
                        e.* = entry;
                        return true;
                    }
                }
                return false;
            } else {
                // just append to the end
                this.cache[this.len] = entry;
                this.len += 1;
                return true;
            }
        }
    };

    var global_cache = GlobalCache{};

    // we just hardcode a STREAM socktype
    const hints: std.c.addrinfo = .{
        .addr = null,
        .addrlen = 0,
        .canonname = null,
        .family = std.c.AF.UNSPEC,
        // If the system is IPv4-only or IPv6-only, then only return the corresponding address family.
        // https://github.com/nodejs/node/commit/54dd7c38e507b35ee0ffadc41a716f1782b0d32f
        // https://bugzilla.mozilla.org/show_bug.cgi?id=467497
        // https://github.com/adobe/chromium/blob/cfe5bf0b51b1f6b9fe239c2a3c2f2364da9967d7/net/base/host_resolver_proc.cc#L122-L241
        // https://github.com/nodejs/node/issues/33816
        // https://github.com/aio-libs/aiohttp/issues/5357
        // https://github.com/libuv/libuv/issues/2225
        .flags = if (Environment.isPosix) bun.C.netdb.AI_ADDRCONFIG else 0,
        .next = null,
        .protocol = 0,
        .socktype = std.c.SOCK.STREAM,
    };

    extern fn us_internal_dns_callback(socket: *bun.uws.ConnectingSocket, req: *Request) void;
    extern fn us_internal_dns_callback_threadsafe(socket: *bun.uws.ConnectingSocket, req: *Request) void;

    pub const DNSRequestOwner = union(enum) {
        socket: *bun.uws.ConnectingSocket,
        prefetch: *bun.uws.Loop,

        pub fn notifyThreadsafe(this: DNSRequestOwner, req: *Request) void {
            switch (this) {
                .socket => |socket| us_internal_dns_callback_threadsafe(socket, req),
                .prefetch => freeaddrinfo(req, 0),
            }
        }

        pub fn notify(this: DNSRequestOwner, req: *Request) void {
            switch (this) {
                .prefetch => freeaddrinfo(req, 0),
                .socket => us_internal_dns_callback(this.socket, req),
            }
        }

        pub fn loop(this: DNSRequestOwner) *bun.uws.Loop {
            return switch (this) {
                .prefetch => this.prefetch,
                .socket => bun.uws.us_connecting_socket_get_loop(this.socket),
            };
        }
    };

    const ResultEntry = extern struct {
        info: std.c.addrinfo,
        addr: std.c.sockaddr.storage,
    };

    // re-order result to interleave ipv4 and ipv6 (also pack into a single allocation)
    fn processResults(info: *std.c.addrinfo) []ResultEntry {
        var count: usize = 0;
        var info_: ?*std.c.addrinfo = info;
        while (info_) |ai| {
            count += 1;
            info_ = ai.next;
        }

        var results = bun.default_allocator.alloc(ResultEntry, count) catch bun.outOfMemory();

        // copy results
        var i: usize = 0;
        info_ = info;
        while (info_) |ai| {
            results[i].info = ai.*;
            if (ai.addr) |addr| {
                if (ai.family == std.c.AF.INET) {
                    const addr_in: *std.c.sockaddr.in = @ptrCast(&results[i].addr);
                    addr_in.* = @as(*std.c.sockaddr.in, @alignCast(@ptrCast(addr))).*;
                } else if (ai.family == std.c.AF.INET6) {
                    const addr_in: *std.c.sockaddr.in6 = @ptrCast(&results[i].addr);
                    addr_in.* = @as(*std.c.sockaddr.in6, @alignCast(@ptrCast(addr))).*;
                }
            } else {
                results[i].addr = std.mem.zeroes(std.c.sockaddr.storage);
            }
            i += 1;
            info_ = ai.next;
        }

        // sort (interleave ipv4 and ipv6)
        var want: usize = std.c.AF.INET6;
        for (0..count) |idx| {
            if (results[idx].info.family == want) continue;
            for (idx + 1..count) |j| {
                if (results[j].info.family == want) {
                    std.mem.swap(ResultEntry, &results[idx], &results[j]);
                    want = if (want == std.c.AF.INET6) std.c.AF.INET else std.c.AF.INET6;
                }
            } else {
                // the rest of the list is all one address family
                break;
            }
        }

        // set up pointers
        for (results, 0..) |*entry, idx| {
            entry.info.canonname = null;
            if (idx + 1 < count) {
                entry.info.next = &results[idx + 1].info;
            } else {
                entry.info.next = null;
            }
            if (entry.info.addr != null) {
                entry.info.addr = @alignCast(@ptrCast(&entry.addr));
            }
        }

        return results;
    }

    fn afterResult(req: *Request, info: ?*std.c.addrinfo, err: c_int) void {
        const results: ?[*]ResultEntry = if (info) |ai| brk: {
            const res = processResults(ai);
            std.c.freeaddrinfo(ai);
            break :brk res.ptr;
        } else null;

        global_cache.lock.lock();

        req.result = .{
            .info = results,
            .err = err,
        };
        var notify = req.notify;
        defer notify.deinit(bun.default_allocator);
        req.notify = .{};
        req.refcount -= 1;

        // is this correct, or should it go after the loop?
        global_cache.lock.unlock();

        for (notify.items) |query| {
            query.notifyThreadsafe(req);
        }
    }

    fn workPoolCallback(req: *Request) void {
        if (Environment.isWindows) {
            const wsa = std.os.windows.ws2_32;
            const wsa_hints = wsa.addrinfo{
                .flags = 0,
                .family = wsa.AF.UNSPEC,
                .socktype = wsa.SOCK.STREAM,
                .protocol = 0,
                .addrlen = 0,
                .canonname = null,
                .addr = null,
                .next = null,
            };

            var addrinfo: ?*wsa.addrinfo = null;
            const err = wsa.getaddrinfo(
                if (req.key.host) |host| host.ptr else null,
                null,
                &wsa_hints,
                &addrinfo,
            );
            afterResult(req, @ptrCast(addrinfo), err);
        } else {
            var addrinfo: ?*std.c.addrinfo = null;
            const err = std.c.getaddrinfo(
                if (req.key.host) |host| host.ptr else null,
                null,
                &hints,
                &addrinfo,
            );
            afterResult(req, addrinfo, @intFromEnum(err));
        }
    }

    pub fn lookupLibinfo(req: *Request, loop: JSC.EventLoopHandle) bool {
        const getaddrinfo_async_start_ = LibInfo.getaddrinfo_async_start() orelse return false;

        var machport: ?*anyopaque = null;
        const errno = getaddrinfo_async_start_(
            &machport,
            if (req.key.host) |host| host.ptr else null,
            null,
            &hints,
            libinfoCallback,
            req,
        );

        if (errno != 0 or machport == null) {
            return false;
        }

        const fake_fd: i32 = @intCast(@intFromPtr(machport));
        var poll = bun.Async.FilePoll.init(loop, bun.toFD(fake_fd), .{}, InternalDNSRequest, req);
        const rc = poll.register(loop.loop(), .machport, true);

        if (rc == .err) {
            poll.deinit();
            return false;
        }

        req.libinfo = .{
            .file_poll = poll,
            .machport = machport,
        };

        return true;
    }

    fn libinfoCallback(
        status: i32,
        addr_info: ?*std.c.addrinfo,
        arg: ?*anyopaque,
    ) callconv(.C) void {
        const req = bun.cast(*Request, arg);
        afterResult(req, addr_info, @intCast(status));
    }

    var dns_cache_hits_completed: usize = 0;
    var dns_cache_hits_inflight: usize = 0;
    var dns_cache_size: usize = 0;
    var dns_cache_misses: usize = 0;
    var dns_cache_errors: usize = 0;
    var getaddrinfo_calls: usize = 0;

    pub fn getDNSCacheStats(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const object = JSC.JSValue.createEmptyObject(globalObject, 6);
        object.put(globalObject, JSC.ZigString.static("cacheHitsCompleted"), JSC.JSValue.jsNumber(@atomicLoad(usize, &dns_cache_hits_completed, .monotonic)));
        object.put(globalObject, JSC.ZigString.static("cacheHitsInflight"), JSC.JSValue.jsNumber(@atomicLoad(usize, &dns_cache_hits_inflight, .monotonic)));
        object.put(globalObject, JSC.ZigString.static("cacheMisses"), JSC.JSValue.jsNumber(@atomicLoad(usize, &dns_cache_misses, .monotonic)));
        object.put(globalObject, JSC.ZigString.static("size"), JSC.JSValue.jsNumber(@atomicLoad(usize, &dns_cache_size, .monotonic)));
        object.put(globalObject, JSC.ZigString.static("errors"), JSC.JSValue.jsNumber(@atomicLoad(usize, &dns_cache_errors, .monotonic)));
        object.put(globalObject, JSC.ZigString.static("totalCount"), JSC.JSValue.jsNumber(@atomicLoad(usize, &getaddrinfo_calls, .monotonic)));
        return object;
    }

    pub fn getaddrinfo(loop: *bun.uws.Loop, host: ?[:0]const u8, is_cache_hit: ?*bool) ?*Request {
        const preload = is_cache_hit == null;
        const key = Request.Key.init(host);
        global_cache.lock.lock();
        getaddrinfo_calls += 1;
        var timestamp_to_store: u32 = 0;
        // is there a cache hit?
        if (!bun.getRuntimeFeatureFlag("BUN_FEATURE_FLAG_DISABLE_DNS_CACHE")) {
            if (global_cache.get(key, &timestamp_to_store)) |entry| {
                if (preload) {
                    global_cache.lock.unlock();
                    return null;
                }

                entry.refcount += 1;

                if (entry.result != null) {
                    is_cache_hit.?.* = true;
                    log("getaddrinfo({s}) = cache hit", .{host orelse ""});
                    dns_cache_hits_completed += 1;
                } else {
                    log("getaddrinfo({s}) = cache hit (inflight)", .{host orelse ""});
                    dns_cache_hits_inflight += 1;
                }

                global_cache.lock.unlock();

                return entry;
            }
        }

        // no cache hit, we have to make a new request
        const req = Request.new(.{
            .key = key.toOwned(),
            .refcount = @as(u32, @intFromBool(!preload)) + 1,

            // Seconds since when this request was created
            .created_at = if (timestamp_to_store == 0) GlobalCache.getCacheTimestamp() else timestamp_to_store,
        });

        _ = global_cache.tryPush(req);
        dns_cache_misses += 1;
        dns_cache_size = global_cache.len;
        global_cache.lock.unlock();

        if (comptime Environment.isMac) {
            if (!bun.getRuntimeFeatureFlag("BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO")) {
                const res = lookupLibinfo(req, loop.internal_loop_data.getParent());
                log("getaddrinfo({s}) = cache miss (libinfo)", .{host orelse ""});
                if (res) return req;
                // if we were not able to use libinfo, we fall back to the work pool
            }
        }

        log("getaddrinfo({s}) = cache miss (libc)", .{host orelse ""});
        // schedule the request to be executed on the work pool
        bun.JSC.WorkPool.go(bun.default_allocator, *Request, req, workPoolCallback) catch bun.outOfMemory();
        return req;
    }

    pub fn prefetchFromJS(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2).slice();

        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("prefetch", 1, arguments.len);
            return .zero;
        }

        const hostname_or_url = arguments[0];

        var hostname_slice = JSC.ZigString.Slice.empty;
        defer hostname_slice.deinit();

        if (hostname_or_url.isString()) {
            hostname_slice = hostname_or_url.toSlice(globalThis, bun.default_allocator);
        } else {
            globalThis.throwInvalidArguments("hostname must be a string", .{});
            return .zero;
        }

        const hostname_z = bun.default_allocator.dupeZ(u8, hostname_slice.slice()) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        defer bun.default_allocator.free(hostname_z);

        prefetch(JSC.VirtualMachine.get().uwsLoop(), hostname_z);
        return .undefined;
    }

    pub fn prefetch(loop: *bun.uws.Loop, hostname: ?[:0]const u8) void {
        _ = getaddrinfo(loop, hostname, null);
    }

    fn us_getaddrinfo(loop: *bun.uws.Loop, _host: ?[*:0]const u8, socket: *?*anyopaque) callconv(.C) c_int {
        const host: ?[:0]const u8 = std.mem.span(_host);
        var is_cache_hit: bool = false;
        const req = getaddrinfo(loop, host, &is_cache_hit).?;
        socket.* = req;
        return if (is_cache_hit) 0 else 1;
    }

    fn us_getaddrinfo_set(
        request: *Request,
        socket: *bun.uws.ConnectingSocket,
    ) callconv(.C) void {
        global_cache.lock.lock();
        defer global_cache.lock.unlock();
        const query = DNSRequestOwner{
            .socket = socket,
        };
        if (request.result != null) {
            query.notify(request);
            return;
        }

        request.notify.append(bun.default_allocator, .{ .socket = socket }) catch bun.outOfMemory();
    }

    fn freeaddrinfo(req: *Request, err: c_int) callconv(.C) void {
        global_cache.lock.lock();
        defer global_cache.lock.unlock();

        req.valid = err == 0;
        dns_cache_errors += @as(usize, @intFromBool(err != 0));

        bun.assert(req.refcount > 0);
        req.refcount -= 1;
        if (req.refcount == 0 and (global_cache.isNearlyFull() or !req.valid)) {
            log("cache --", .{});
            global_cache.remove(req);
            req.deinit();
        }
    }

    fn getRequestResult(req: *Request) callconv(.C) *Request.Result {
        return &req.result.?;
    }
};

pub const InternalDNSRequest = InternalDNS.Request;

comptime {
    @export(InternalDNS.us_getaddrinfo_set, .{
        .name = "Bun__addrinfo_set",
    });
    @export(InternalDNS.us_getaddrinfo, .{
        .name = "Bun__addrinfo_get",
    });
    @export(InternalDNS.freeaddrinfo, .{
        .name = "Bun__addrinfo_freeRequest",
    });
    @export(InternalDNS.getRequestResult, .{
        .name = "Bun__addrinfo_getRequestResult",
    });
}

pub const DNSResolver = struct {
    const log = Output.scoped(.DNSResolver, false);

    channel: ?*c_ares.Channel = null,
    vm: *JSC.VirtualMachine,
    polls: PollsMap = undefined,

    pending_host_cache_cares: PendingCache = PendingCache.init(),
    pending_host_cache_native: PendingCache = PendingCache.init(),
    pending_srv_cache_cares: SrvPendingCache = SrvPendingCache.init(),
    pending_soa_cache_cares: SoaPendingCache = SoaPendingCache.init(),
    pending_txt_cache_cares: TxtPendingCache = TxtPendingCache.init(),
    pending_naptr_cache_cares: NaptrPendingCache = NaptrPendingCache.init(),
    pending_mx_cache_cares: MxPendingCache = MxPendingCache.init(),
    pending_caa_cache_cares: CaaPendingCache = CaaPendingCache.init(),
    pending_ns_cache_cares: NSPendingCache = NSPendingCache.init(),
    pending_ptr_cache_cares: PtrPendingCache = PtrPendingCache.init(),
    pending_cname_cache_cares: CnamePendingCache = CnamePendingCache.init(),
    pending_addr_cache_crares: AddrPendingCache = AddrPendingCache.init(),
    pending_nameinfo_cache_cares: NameInfoPendingCache = NameInfoPendingCache.init(),

    const PollsMap = std.AutoArrayHashMap(c_ares.ares_socket_t, *PollType);

    const PollType = if (Environment.isWindows)
        UvDnsPoll
    else
        Async.FilePoll;

    const UvDnsPoll = struct {
        parent: *DNSResolver,
        socket: c_ares.ares_socket_t,
        poll: bun.windows.libuv.uv_poll_t,

        pub fn fromPoll(poll: *bun.windows.libuv.uv_poll_t) *UvDnsPoll {
            const poll_bytes: [*]u8 = @ptrCast(poll);
            const result: [*]u8 = poll_bytes - @offsetOf(UvDnsPoll, "poll");
            return @alignCast(@ptrCast(result));
        }

        pub usingnamespace bun.New(@This());
    };

    const PendingCache = bun.HiveArray(GetAddrInfoRequest.PendingCacheKey, 32);
    const SrvPendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.struct_ares_srv_reply, "srv").PendingCacheKey, 32);
    const SoaPendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.struct_ares_soa_reply, "soa").PendingCacheKey, 32);
    const TxtPendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.struct_ares_txt_reply, "txt").PendingCacheKey, 32);
    const NaptrPendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.struct_ares_naptr_reply, "naptr").PendingCacheKey, 32);
    const MxPendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.struct_ares_mx_reply, "mx").PendingCacheKey, 32);
    const CaaPendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.struct_ares_caa_reply, "caa").PendingCacheKey, 32);
    const NSPendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.struct_hostent, "ns").PendingCacheKey, 32);
    const PtrPendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.struct_hostent, "ptr").PendingCacheKey, 32);
    const CnamePendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.struct_hostent, "cname").PendingCacheKey, 32);
    const AddrPendingCache = bun.HiveArray(GetHostByAddrInfoRequest.PendingCacheKey, 32);
    const NameInfoPendingCache = bun.HiveArray(GetNameInfoRequest.PendingCacheKey, 32);

    fn getKey(this: *DNSResolver, index: u8, comptime cache_name: []const u8, comptime request_type: type) request_type.PendingCacheKey {
        var cache = &@field(this, cache_name);
        bun.assert(!cache.available.isSet(index));
        const entry = cache.buffer[index];
        cache.buffer[index] = undefined;

        var available = cache.available;
        available.set(index);
        cache.available = available;

        return entry;
    }

    pub fn drainPendingCares(this: *DNSResolver, index: u8, err: ?c_ares.Error, timeout: i32, comptime request_type: type, comptime cares_type: type, comptime lookup_name: []const u8, result: ?*cares_type) void {
        const cache_name = comptime std.fmt.comptimePrint("pending_{s}_cache_cares", .{lookup_name});

        const key = this.getKey(index, cache_name, request_type);

        var addr = result orelse {
            var pending: ?*CAresLookup(cares_type, lookup_name) = key.lookup.head.next;
            key.lookup.head.processResolve(err, timeout, null);
            bun.default_allocator.destroy(key.lookup);

            while (pending) |value| {
                pending = value.next;
                value.processResolve(err, timeout, null);
            }
            return;
        };

        var pending: ?*CAresLookup(cares_type, lookup_name) = key.lookup.head.next;
        var prev_global = key.lookup.head.globalThis;
        var array = addr.toJSResponse(this.vm.allocator, prev_global, lookup_name);
        defer addr.deinit();
        array.ensureStillAlive();
        key.lookup.head.onComplete(array);
        bun.default_allocator.destroy(key.lookup);

        array.ensureStillAlive();

        while (pending) |value| {
            const new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addr.toJSResponse(this.vm.allocator, new_global, lookup_name);
                prev_global = new_global;
            }
            pending = value.next;

            {
                array.ensureStillAlive();
                value.onComplete(array);
                array.ensureStillAlive();
            }
        }
    }

    pub fn drainPendingHostCares(this: *DNSResolver, index: u8, err: ?c_ares.Error, timeout: i32, result: ?*c_ares.AddrInfo) void {
        const key = this.getKey(index, "pending_host_cache_cares", GetAddrInfoRequest);

        var addr = result orelse {
            var pending: ?*DNSLookup = key.lookup.head.next;
            key.lookup.head.processGetAddrInfo(err, timeout, null);
            bun.default_allocator.destroy(key.lookup);

            while (pending) |value| {
                pending = value.next;
                value.processGetAddrInfo(err, timeout, null);
            }
            return;
        };

        var pending: ?*DNSLookup = key.lookup.head.next;
        var prev_global = key.lookup.head.globalThis;
        var array = addr.toJSArray(prev_global);
        defer addr.deinit();
        array.ensureStillAlive();
        key.lookup.head.onCompleteWithArray(array);
        bun.default_allocator.destroy(key.lookup);

        array.ensureStillAlive();
        // std.c.addrinfo

        while (pending) |value| {
            const new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addr.toJSArray(new_global);
                prev_global = new_global;
            }
            pending = value.next;

            {
                array.ensureStillAlive();
                value.onCompleteWithArray(array);
                array.ensureStillAlive();
            }
        }
    }

    pub fn drainPendingHostNative(this: *DNSResolver, index: u8, globalObject: *JSC.JSGlobalObject, err: i32, result: GetAddrInfo.Result.Any) void {
        log("drainPendingHostNative", .{});
        const key = this.getKey(index, "pending_host_cache_native", GetAddrInfoRequest);

        var array = result.toJS(globalObject) orelse {
            var pending: ?*DNSLookup = key.lookup.head.next;
            var head = key.lookup.head;
            head.processGetAddrInfoNative(err, null);
            bun.default_allocator.destroy(key.lookup);

            while (pending) |value| {
                pending = value.next;
                value.processGetAddrInfoNative(err, null);
            }

            return;
        };
        var pending: ?*DNSLookup = key.lookup.head.next;
        var prev_global = key.lookup.head.globalThis;

        {
            array.ensureStillAlive();
            key.lookup.head.onCompleteWithArray(array);
            bun.default_allocator.destroy(key.lookup);
            array.ensureStillAlive();
        }

        // std.c.addrinfo

        while (pending) |value| {
            const new_global = value.globalThis;
            pending = value.next;
            if (prev_global != new_global) {
                array = result.toJS(new_global).?;
                prev_global = new_global;
            }

            {
                array.ensureStillAlive();
                value.onCompleteWithArray(array);
                array.ensureStillAlive();
            }
        }
    }

    pub fn drainPendingAddrCares(this: *DNSResolver, index: u8, err: ?c_ares.Error, timeout: i32, result: ?*c_ares.struct_hostent) void {
        const key = this.getKey(index, "pending_addr_cache_crares", GetHostByAddrInfoRequest);

        var addr = result orelse {
            var pending: ?*CAresReverse = key.lookup.head.next;
            key.lookup.head.processResolve(err, timeout, null);
            bun.default_allocator.destroy(key.lookup);

            while (pending) |value| {
                pending = value.next;
                value.processResolve(err, timeout, null);
            }
            return;
        };

        var pending: ?*CAresReverse = key.lookup.head.next;
        var prev_global = key.lookup.head.globalThis;
        //  The callback need not and should not attempt to free the memory
        //  pointed to by hostent; the ares library will free it when the
        //  callback returns.
        var array = addr.toJSResponse(this.vm.allocator, prev_global, "");
        array.ensureStillAlive();
        key.lookup.head.onComplete(array);
        bun.default_allocator.destroy(key.lookup);

        array.ensureStillAlive();

        while (pending) |value| {
            const new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addr.toJSResponse(this.vm.allocator, new_global, "");
                prev_global = new_global;
            }
            pending = value.next;

            {
                array.ensureStillAlive();
                value.onComplete(array);
                array.ensureStillAlive();
            }
        }
    }

    pub fn drainPendingNameInfoCares(this: *DNSResolver, index: u8, err: ?c_ares.Error, timeout: i32, result: ?c_ares.struct_nameinfo) void {
        const key = this.getKey(index, "pending_nameinfo_cache_cares", GetNameInfoRequest);

        var name_info = result orelse {
            var pending: ?*CAresNameInfo = key.lookup.head.next;
            key.lookup.head.processResolve(err, timeout, null);
            bun.default_allocator.destroy(key.lookup);

            while (pending) |value| {
                pending = value.next;
                value.processResolve(err, timeout, null);
            }
            return;
        };

        var pending: ?*CAresNameInfo = key.lookup.head.next;
        var prev_global = key.lookup.head.globalThis;

        var array = name_info.toJSResponse(this.vm.allocator, prev_global);
        array.ensureStillAlive();
        key.lookup.head.onComplete(array);
        bun.default_allocator.destroy(key.lookup);

        array.ensureStillAlive();

        while (pending) |value| {
            const new_global = value.globalThis;
            if (prev_global != new_global) {
                array = name_info.toJSResponse(this.vm.allocator, new_global);
                prev_global = new_global;
            }
            pending = value.next;

            {
                array.ensureStillAlive();
                value.onComplete(array);
                array.ensureStillAlive();
            }
        }
    }

    pub const CacheHit = union(enum) {
        inflight: *GetAddrInfoRequest.PendingCacheKey,
        new: *GetAddrInfoRequest.PendingCacheKey,
        disabled: void,
    };

    pub fn LookupCacheHit(comptime request_type: type) type {
        return union(enum) {
            inflight: *request_type.PendingCacheKey,
            new: *request_type.PendingCacheKey,
            disabled: void,
        };
    }

    pub fn getOrPutIntoResolvePendingCache(
        this: *DNSResolver,
        comptime request_type: type,
        key: request_type.PendingCacheKey,
        comptime field: []const u8,
    ) LookupCacheHit(request_type) {
        var cache = &@field(this, field);
        var inflight_iter = cache.available.iterator(
            .{
                .kind = .unset,
            },
        );

        while (inflight_iter.next()) |index| {
            const entry: *request_type.PendingCacheKey = &cache.buffer[index];
            if (entry.hash == key.hash and entry.len == key.len) {
                return .{ .inflight = entry };
            }
        }

        if (cache.get()) |new| {
            new.hash = key.hash;
            new.len = key.len;
            return .{ .new = new };
        }

        return .{ .disabled = {} };
    }

    pub fn getOrPutIntoPendingCache(
        this: *DNSResolver,
        key: GetAddrInfoRequest.PendingCacheKey,
        comptime field: std.meta.FieldEnum(DNSResolver),
    ) CacheHit {
        var cache: *PendingCache = &@field(this, @tagName(field));
        var inflight_iter = cache.available.iterator(
            .{
                .kind = .unset,
            },
        );

        while (inflight_iter.next()) |index| {
            const entry: *GetAddrInfoRequest.PendingCacheKey = &cache.buffer[index];
            if (entry.hash == key.hash and entry.len == key.len) {
                return .{ .inflight = entry };
            }
        }

        if (cache.get()) |new| {
            new.hash = key.hash;
            new.len = key.len;
            return .{ .new = new };
        }

        return .{ .disabled = {} };
    }

    pub const ChannelResult = union(enum) {
        err: c_ares.Error,
        result: *c_ares.Channel,
    };
    pub fn getChannel(this: *DNSResolver) ChannelResult {
        if (this.channel == null) {
            if (c_ares.Channel.init(DNSResolver, this)) |err| {
                return .{ .err = err };
            }
        }

        return .{ .result = this.channel.? };
    }

    pub fn onDNSPollUv(watcher: [*c]bun.windows.libuv.uv_poll_t, status: c_int, events: c_int) callconv(.C) void {
        const poll = UvDnsPoll.fromPoll(watcher);
        const vm = poll.parent.vm;
        vm.eventLoop().enter();
        defer vm.eventLoop().exit();
        // channel must be non-null here as c_ares must have been initialized if we're receiving callbacks
        const channel = poll.parent.channel.?;
        if (status < 0) {
            // an error occurred. just pretend that the socket is both readable and writable.
            // https://github.com/nodejs/node/blob/8a41d9b636be86350cd32847c3f89d327c4f6ff7/src/cares_wrap.cc#L93
            channel.process(poll.socket, true, true);
            return;
        }
        channel.process(
            poll.socket,
            events & bun.windows.libuv.UV_READABLE != 0,
            events & bun.windows.libuv.UV_WRITABLE != 0,
        );
    }

    pub fn onCloseUv(watcher: *anyopaque) callconv(.C) void {
        const poll = UvDnsPoll.fromPoll(@alignCast(@ptrCast(watcher)));
        poll.destroy();
    }

    pub fn onDNSPoll(
        this: *DNSResolver,
        poll: *Async.FilePoll,
    ) void {
        var vm = this.vm;
        vm.eventLoop().enter();
        defer vm.eventLoop().exit();
        var channel = this.channel orelse {
            _ = this.polls.orderedRemove(poll.fd.int());
            poll.deinit();
            return;
        };

        channel.process(
            poll.fd.int(),
            poll.isReadable(),
            poll.isWritable(),
        );
    }

    pub fn onDNSSocketState(
        this: *DNSResolver,
        fd: c_ares.ares_socket_t,
        readable: bool,
        writable: bool,
    ) void {
        if (comptime Environment.isWindows) {
            const uv = bun.windows.libuv;
            if (!readable and !writable) {
                // cleanup
                if (this.polls.fetchOrderedRemove(fd)) |entry| {
                    uv.uv_close(@ptrCast(&entry.value.poll), onCloseUv);
                }
                return;
            }

            const poll_entry = this.polls.getOrPut(fd) catch bun.outOfMemory();
            if (!poll_entry.found_existing) {
                const poll = UvDnsPoll.new(.{
                    .parent = this,
                    .socket = fd,
                    .poll = undefined,
                });
                if (uv.uv_poll_init_socket(bun.uws.Loop.get().uv_loop, &poll.poll, @ptrCast(fd)) < 0) {
                    poll.destroy();
                    _ = this.polls.swapRemove(fd);
                    return;
                }
                poll_entry.value_ptr.* = poll;
            }

            const poll: *UvDnsPoll = poll_entry.value_ptr.*;

            const uv_events = if (readable) uv.UV_READABLE else 0 | if (writable) uv.UV_WRITABLE else 0;
            if (uv.uv_poll_start(&poll.poll, uv_events, onDNSPollUv) < 0) {
                _ = this.polls.swapRemove(fd);
                uv.uv_close(@ptrCast(&poll.poll), onCloseUv);
            }
        } else {
            const vm = this.vm;

            if (!readable and !writable) {
                // read == 0 and write == 0 this is c-ares's way of notifying us that
                // the socket is now closed. We must free the data associated with
                // socket.
                if (this.polls.fetchOrderedRemove(fd)) |entry| {
                    entry.value.deinitWithVM(vm);
                }

                return;
            }

            const poll_entry = this.polls.getOrPut(fd) catch unreachable;

            if (!poll_entry.found_existing) {
                poll_entry.value_ptr.* = Async.FilePoll.init(vm, bun.toFD(fd), .{}, DNSResolver, this);
            }

            var poll = poll_entry.value_ptr.*;

            if (readable and !poll.flags.contains(.poll_readable))
                _ = poll.register(vm.event_loop_handle.?, .readable, false);

            if (writable and !poll.flags.contains(.poll_writable))
                _ = poll.register(vm.event_loop_handle.?, .writable, false);
        }
    }

    const DNSQuery = struct {
        name: JSC.ZigString.Slice,
        record_type: RecordType,

        ttl: i32 = 0,
    };

    pub const RecordType = enum(u8) {
        A = 1,
        AAAA = 28,
        CNAME = 5,
        MX = 15,
        NS = 2,
        PTR = 12,
        SOA = 6,
        SRV = 33,
        TXT = 16,

        pub const default = RecordType.A;

        pub const map = bun.ComptimeStringMap(RecordType, .{
            .{ "A", .A },
            .{ "AAAA", .AAAA },
            .{ "CNAME", .CNAME },
            .{ "MX", .MX },
            .{ "NS", .NS },
            .{ "PTR", .PTR },
            .{ "SOA", .SOA },
            .{ "SRV", .SRV },
            .{ "TXT", .TXT },
            .{ "a", .A },
            .{ "aaaa", .AAAA },
            .{ "cname", .CNAME },
            .{ "mx", .MX },
            .{ "ns", .NS },
            .{ "ptr", .PTR },
            .{ "soa", .SOA },
            .{ "srv", .SRV },
            .{ "txt", .TXT },
        });
    };

    pub fn resolve(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(3);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("resolve", 2, arguments.len);
            return .zero;
        }

        const record_type: RecordType = if (arguments.len == 1)
            RecordType.default
        else brk: {
            const record_type_value = arguments.ptr[1];
            if (record_type_value.isEmptyOrUndefinedOrNull() or !record_type_value.isString()) {
                break :brk RecordType.default;
            }

            const record_type_str = record_type_value.toStringOrNull(globalThis) orelse {
                return .zero;
            };

            if (record_type_str.length() == 0) {
                break :brk RecordType.default;
            }

            break :brk RecordType.map.getWithEql(record_type_str.getZigString(globalThis), JSC.ZigString.eqlComptime) orelse {
                globalThis.throwInvalidArgumentType("resolve", "record", "one of: A, AAAA, CNAME, MX, NS, PTR, SOA, SRV, TXT");
                return .zero;
            };
        };

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("resolve", "name", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("resolve", "name", "non-empty string");
            return .zero;
        }

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);
        //TODO: ANY CASE
        switch (record_type) {
            RecordType.A => {
                defer name.deinit();
                const options = GetAddrInfo.Options{ .family = GetAddrInfo.Family.inet };
                return resolver.doLookup(name.slice(), 0, options, globalThis);
            },
            RecordType.AAAA => {
                defer name.deinit();
                const options = GetAddrInfo.Options{ .family = GetAddrInfo.Family.inet6 };
                return resolver.doLookup(name.slice(), 0, options, globalThis);
            },
            RecordType.CNAME => {
                return resolver.doResolveCAres(c_ares.struct_hostent, "cname", name.slice(), globalThis);
            },
            RecordType.MX => {
                return resolver.doResolveCAres(c_ares.struct_ares_mx_reply, "mx", name.slice(), globalThis);
            },
            RecordType.NS => {
                return resolver.doResolveCAres(c_ares.struct_hostent, "ns", name.slice(), globalThis);
            },
            RecordType.PTR => {
                return resolver.doResolveCAres(c_ares.struct_hostent, "ptr", name.slice(), globalThis);
            },
            RecordType.SOA => {
                return resolver.doResolveCAres(c_ares.struct_ares_soa_reply, "soa", name.slice(), globalThis);
            },
            RecordType.SRV => {
                return resolver.doResolveCAres(c_ares.struct_ares_srv_reply, "srv", name.slice(), globalThis);
            },
            RecordType.TXT => {
                return resolver.doResolveCAres(c_ares.struct_ares_txt_reply, "txt", name.slice(), globalThis);
            },
        }
    }

    pub fn reverse(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("reverse", 2, arguments.len);
            return .zero;
        }

        const ip_value = arguments.ptr[0];
        if (ip_value.isEmptyOrUndefinedOrNull() or !ip_value.isString()) {
            globalThis.throwInvalidArgumentType("reverse", "ip", "string");
            return .zero;
        }

        const ip_str = ip_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };
        if (ip_str.length() == 0) {
            globalThis.throwInvalidArgumentType("reverse", "ip", "non-empty string");
            return .zero;
        }

        const ip_slice = ip_str.toSliceClone(globalThis, bun.default_allocator);
        const ip = ip_slice.slice();
        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);
        var channel: *c_ares.Channel = switch (resolver.getChannel()) {
            .result => |res| res,
            .err => |err| {
                defer ip_slice.deinit();
                globalThis.throwValue(err.toJS(globalThis));
                return .zero;
            },
        };

        const key = GetHostByAddrInfoRequest.PendingCacheKey.init(ip);
        var cache = resolver.getOrPutIntoResolvePendingCache(
            GetHostByAddrInfoRequest,
            key,
            "pending_addr_cache_crares",
        );
        if (cache == .inflight) {
            var cares_reverse = CAresReverse.init(globalThis, globalThis.allocator(), ip) catch unreachable;
            cache.inflight.append(cares_reverse);
            return cares_reverse.promise.value();
        }

        var request = GetHostByAddrInfoRequest.init(
            cache,
            resolver,
            ip,
            globalThis,
            "pending_addr_cache_crares",
        ) catch unreachable;

        const promise = request.tail.promise.value();
        channel.getHostByAddr(
            ip,
            GetHostByAddrInfoRequest,
            request,
            GetHostByAddrInfoRequest.onCaresComplete,
        );

        return promise;
    }

    pub fn lookup(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("lookup", 2, arguments.len);
            return .zero;
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("lookup", "hostname", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("lookup", "hostname", "non-empty string");
            return .zero;
        }

        var options = GetAddrInfo.Options{};
        var port: u16 = 0;

        if (arguments.len > 1 and arguments.ptr[1].isCell()) {
            if (arguments.ptr[1].get(globalThis, "port")) |port_value| {
                if (port_value.isNumber()) {
                    port = port_value.to(u16);
                }
            }

            options = GetAddrInfo.Options.fromJS(arguments.ptr[1], globalThis) catch |err| {
                globalThis.throw("Invalid options passed to lookup(): {s}", .{@errorName(err)});
                return .zero;
            };
        }

        const name = name_str.toSlice(globalThis, bun.default_allocator);
        defer name.deinit();
        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doLookup(name.slice(), port, options, globalThis);
    }

    pub fn doLookup(this: *DNSResolver, name: []const u8, port: u16, options: GetAddrInfo.Options, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        var opts = options;
        var backend = opts.backend;
        const normalized = normalizeDNSName(name, &backend);
        opts.backend = backend;
        const query = GetAddrInfo{
            .options = opts,
            .port = port,
            .name = normalized,
        };

        return switch (opts.backend) {
            .c_ares => this.c_aresLookupWithNormalizedName(query, globalThis),
            .libc => (if (Environment.isWindows) LibUVBackend else LibC)
                .lookup(this, query, globalThis),
            .system => switch (comptime Environment.os) {
                .mac => LibInfo.lookup(this, query, globalThis),
                .windows => LibUVBackend.lookup(this, query, globalThis),
                else => LibC.lookup(this, query, globalThis),
            },
        };
    }

    pub fn resolveSrv(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("resolveSrv", 2, arguments.len);
            return .zero;
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("resolveSrv", "hostname", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("resolveSrv", "hostname", "non-empty string");
            return .zero;
        }

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_ares_srv_reply, "srv", name.slice(), globalThis);
    }

    pub fn resolveSoa(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("resolveSoa", 2, arguments.len);
            return .zero;
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("resolveSoa", "hostname", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_ares_soa_reply, "soa", name.slice(), globalThis);
    }

    pub fn resolveCaa(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("resolveCaa", 2, arguments.len);
            return .zero;
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("resolveCaa", "hostname", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("resolveCaa", "hostname", "non-empty string");
            return .zero;
        }

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_ares_caa_reply, "caa", name.slice(), globalThis);
    }

    pub fn resolveNs(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("resolveNs", 2, arguments.len);
            return .zero;
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("resolveNs", "hostname", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_hostent, "ns", name.slice(), globalThis);
    }

    pub fn resolvePtr(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("resolvePtr", 2, arguments.len);
            return .zero;
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("resolvePtr", "hostname", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("resolvePtr", "hostname", "non-empty string");
            return .zero;
        }

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_hostent, "ptr", name.slice(), globalThis);
    }

    pub fn resolveCname(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("resolveCname", 2, arguments.len);
            return .zero;
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("resolveCname", "hostname", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("resolveCname", "hostname", "non-empty string");
            return .zero;
        }

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_hostent, "cname", name.slice(), globalThis);
    }

    pub fn resolveMx(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("resolveMx", 2, arguments.len);
            return .zero;
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("resolveMx", "hostname", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("resolveMx", "hostname", "non-empty string");
            return .zero;
        }

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_ares_mx_reply, "mx", name.slice(), globalThis);
    }

    pub fn resolveNaptr(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("resolveNaptr", 2, arguments.len);
            return .zero;
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("resolveNaptr", "hostname", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("resolveNaptr", "hostname", "non-empty string");
            return .zero;
        }

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_ares_naptr_reply, "naptr", name.slice(), globalThis);
    }

    pub fn resolveTxt(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(2);
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("resolveTxt", 2, arguments.len);
            return .zero;
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            globalThis.throwInvalidArgumentType("resolveTxt", "hostname", "string");
            return .zero;
        }

        const name_str = name_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("resolveTxt", "hostname", "non-empty string");
            return .zero;
        }

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_ares_txt_reply, "txt", name.slice(), globalThis);
    }

    pub fn doResolveCAres(this: *DNSResolver, comptime cares_type: type, comptime type_name: []const u8, name: []const u8, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        var channel: *c_ares.Channel = switch (this.getChannel()) {
            .result => |res| res,
            .err => |err| {
                globalThis.throwValue(err.toJS(globalThis));
                return .zero;
            },
        };

        const cache_name = comptime std.fmt.comptimePrint("pending_{s}_cache_cares", .{type_name});

        const key = ResolveInfoRequest(cares_type, type_name).PendingCacheKey.init(name);

        var cache = this.getOrPutIntoResolvePendingCache(ResolveInfoRequest(cares_type, type_name), key, cache_name);
        if (cache == .inflight) {
            // CAresLookup will have the name ownership
            var cares_lookup = CAresLookup(cares_type, type_name).init(globalThis, globalThis.allocator(), name) catch unreachable;
            cache.inflight.append(cares_lookup);
            return cares_lookup.promise.value();
        }

        var request = ResolveInfoRequest(cares_type, type_name).init(
            cache,
            this,
            name, // CAresLookup will have the ownership
            globalThis,
            cache_name,
        ) catch unreachable;
        const promise = request.tail.promise.value();

        channel.resolve(
            name,
            type_name,
            ResolveInfoRequest(cares_type, type_name),
            request,
            cares_type,
            ResolveInfoRequest(cares_type, type_name).onCaresComplete,
        );

        return promise;
    }
    pub fn c_aresLookupWithNormalizedName(this: *DNSResolver, query: GetAddrInfo, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        var channel: *c_ares.Channel = switch (this.getChannel()) {
            .result => |res| res,
            .err => |err| {
                const system_error = JSC.SystemError{
                    .errno = -1,
                    .code = bun.String.static(err.code()),
                    .message = bun.String.static(err.label()),
                };

                globalThis.throwValue(system_error.toErrorInstance(globalThis));
                return .zero;
            },
        };

        const key = GetAddrInfoRequest.PendingCacheKey.init(query);

        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_cares);
        if (cache == .inflight) {
            var dns_lookup = DNSLookup.init(globalThis, globalThis.allocator()) catch unreachable;
            cache.inflight.append(dns_lookup);
            return dns_lookup.promise.value();
        }

        const hints_buf = &[_]c_ares.AddrInfo_hints{query.toCAres()};
        var request = GetAddrInfoRequest.init(
            cache,
            .{
                .c_ares = {},
            },
            this,
            query,
            globalThis,
            "pending_host_cache_cares",
        ) catch unreachable;
        const promise = request.tail.promise.value();

        channel.getAddrInfo(
            query.name,
            query.port,
            hints_buf,
            GetAddrInfoRequest,
            request,
            GetAddrInfoRequest.onCaresComplete,
        );

        return promise;
    }

    pub fn getServers(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        _ = callframe;

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);
        const channel: *c_ares.Channel = switch (resolver.getChannel()) {
            .result => |res| res,
            .err => |err| {
                const system_error = JSC.SystemError{
                    .errno = -1,
                    .code = bun.String.static(err.code()),
                    .message = bun.String.static(err.label()),
                };

                globalThis.throwValue(system_error.toErrorInstance(globalThis));
                return .zero;
            },
        };

        var servers: ?*c_ares.struct_ares_addr_port_node = null;
        const r = c_ares.ares_get_servers_ports(channel, &servers);
        if (r != c_ares.ARES_SUCCESS) {
            const err = c_ares.Error.get(r).?;
            globalThis.throwValue(globalThis.createErrorInstance("ares_get_servers_ports error: {s}", .{err.label()}));
            return .zero;
        }
        defer c_ares.ares_free_data(servers);

        const values = JSC.JSValue.createEmptyArray(globalThis, 0);

        var i: u32 = 0;
        var cur = servers;
        while (cur) |current| : ({
            i += 1;
            cur = current.next;
        }) {
            // Formatting reference: https://nodejs.org/api/dns.html#dnsgetservers
            // Brackets '[' and ']' consume 2 bytes, used for IPv6 format (e.g., '[2001:4860:4860::8888]:1053').
            // Port range is 6 bytes (e.g., ':65535').
            // Null terminator '\0' uses 1 byte.
            var buf: [INET6_ADDRSTRLEN + 2 + 6 + 1]u8 = undefined;
            const family = current.family;

            const ip = if (family == std.posix.AF.INET6) blk: {
                break :blk c_ares.ares_inet_ntop(family, &current.addr.addr6, buf[1..], @sizeOf(@TypeOf(buf)) - 1);
            } else blk: {
                break :blk c_ares.ares_inet_ntop(family, &current.addr.addr4, buf[1..], @sizeOf(@TypeOf(buf)) - 1);
            };
            if (ip == null) {
                globalThis.throwValue(globalThis.createErrorInstance(
                    "ares_inet_ntop error: no more space to convert a network format address",
                    .{},
                ));
                return .zero;
            }

            var port = current.tcp_port;
            if (port == 0) {
                port = current.udp_port;
            }
            if (port == 0) {
                port = IANA_DNS_PORT;
            }

            const size = bun.len(bun.cast([*:0]u8, buf[1..])) + 1;
            if (port == IANA_DNS_PORT) {
                values.putIndex(globalThis, i, JSC.ZigString.init(buf[1..size]).withEncoding().toJS(globalThis));
            } else {
                if (family == std.posix.AF.INET6) {
                    buf[0] = '[';
                    buf[size] = ']';
                    const port_slice = std.fmt.bufPrint(buf[size + 1 ..], ":{d}", .{port}) catch unreachable;
                    values.putIndex(globalThis, i, JSC.ZigString.init(buf[0 .. size + 1 + port_slice.len]).withEncoding().toJS(globalThis));
                } else {
                    const port_slice = std.fmt.bufPrint(buf[size..], ":{d}", .{port}) catch unreachable;
                    values.putIndex(globalThis, i, JSC.ZigString.init(buf[1 .. size + port_slice.len]).withEncoding().toJS(globalThis));
                }
            }
        }

        return values;
    }

    // Resolves the given address and port into a host name and service using the operating system's underlying getnameinfo implementation.
    // If address is not a valid IP address, a TypeError will be thrown. The port will be coerced to a number.
    // If it is not a legal port, a TypeError will be thrown.
    pub fn lookupService(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        const arguments = callframe.arguments(3);
        if (arguments.len < 2) {
            globalThis.throwNotEnoughArguments("lookupService", 3, arguments.len);
            return .zero;
        }

        const addr_value = arguments.ptr[0];
        const port_value = arguments.ptr[1];
        if (addr_value.isEmptyOrUndefinedOrNull() or !addr_value.isString()) {
            globalThis.throwInvalidArgumentType("lookupService", "address", "string");
            return .zero;
        }
        const addr_str = addr_value.toStringOrNull(globalThis) orelse {
            return .zero;
        };
        if (addr_str.length() == 0) {
            globalThis.throwInvalidArgumentType("lookupService", "address", "non-empty string");
            return .zero;
        }

        const addr_s = addr_str.getZigString(globalThis).slice();
        const port: u16 = if (port_value.isNumber()) blk: {
            break :blk port_value.to(u16);
        } else {
            globalThis.throwInvalidArgumentType("lookupService", "port", "invalid port");
            return .zero;
        };

        var sa: std.posix.sockaddr.storage = std.mem.zeroes(std.posix.sockaddr.storage);
        if (c_ares.getSockaddr(addr_s, port, @as(*std.posix.sockaddr, @ptrCast(&sa))) != 0) {
            globalThis.throwInvalidArgumentType("lookupService", "address", "invalid address");
            return .zero;
        }

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);
        var channel: *c_ares.Channel = switch (resolver.getChannel()) {
            .result => |res| res,
            .err => |err| {
                const system_error = JSC.SystemError{
                    .errno = -1,
                    .code = bun.String.static(err.code()),
                    .message = bun.String.static(err.label()),
                };

                globalThis.throwValue(system_error.toErrorInstance(globalThis));
                return .zero;
            },
        };

        // This string will be freed in `CAresNameInfo.deinit`
        const cache_name = std.fmt.allocPrint(bun.default_allocator, "{s}|{d}", .{ addr_s, port }) catch unreachable;

        const key = GetNameInfoRequest.PendingCacheKey.init(cache_name);
        var cache = resolver.getOrPutIntoResolvePendingCache(
            GetNameInfoRequest,
            key,
            "pending_nameinfo_cache_cares",
        );

        if (cache == .inflight) {
            var info = CAresNameInfo.init(globalThis, globalThis.allocator(), cache_name) catch unreachable;
            cache.inflight.append(info);
            return info.promise.value();
        }

        var request = GetNameInfoRequest.init(
            cache,
            resolver,
            cache_name, // transfer ownership here
            globalThis,
            "pending_nameinfo_cache_cares",
        ) catch unreachable;

        const promise = request.tail.promise.value();
        channel.getNameInfo(
            @as(*std.posix.sockaddr, @ptrCast(&sa)),
            GetNameInfoRequest,
            request,
            GetNameInfoRequest.onCaresComplete,
        );

        return promise;
    }

    comptime {
        @export(
            resolve,
            .{
                .name = "Bun__DNSResolver__resolve",
            },
        );
        @export(
            lookup,
            .{
                .name = "Bun__DNSResolver__lookup",
            },
        );
        @export(
            resolveTxt,
            .{
                .name = "Bun__DNSResolver__resolveTxt",
            },
        );
        @export(
            resolveSoa,
            .{
                .name = "Bun__DNSResolver__resolveSoa",
            },
        );
        @export(
            resolveMx,
            .{
                .name = "Bun__DNSResolver__resolveMx",
            },
        );
        @export(
            resolveNaptr,
            .{
                .name = "Bun__DNSResolver__resolveNaptr",
            },
        );
        @export(
            resolveSrv,
            .{
                .name = "Bun__DNSResolver__resolveSrv",
            },
        );
        @export(
            resolveCaa,
            .{
                .name = "Bun__DNSResolver__resolveCaa",
            },
        );
        @export(
            resolveNs,
            .{
                .name = "Bun__DNSResolver__resolveNs",
            },
        );
        @export(
            resolvePtr,
            .{
                .name = "Bun__DNSResolver__resolvePtr",
            },
        );
        @export(
            resolveCname,
            .{
                .name = "Bun__DNSResolver__resolveCname",
            },
        );
        @export(
            getServers,
            .{
                .name = "Bun__DNSResolver__getServers",
            },
        );
        @export(
            reverse,
            .{
                .name = "Bun__DNSResolver__reverse",
            },
        );
        @export(
            lookupService,
            .{
                .name = "Bun__DNSResolver__lookupService",
            },
        );
        @export(
            InternalDNS.prefetchFromJS,
            .{
                .name = "Bun__DNSResolver__prefetch",
            },
        );
        @export(InternalDNS.getDNSCacheStats, .{
            .name = "Bun__DNSResolver__getCacheStats",
        });
    }
};
