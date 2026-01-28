const dns = @This();

const GetAddrInfoAsyncCallback = fn (i32, ?*std.c.addrinfo, ?*anyopaque) callconv(.c) void;
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
    const GetaddrinfoAsyncStart = fn (*bun.mach_port, noalias node: ?[*:0]const u8, noalias service: ?[*:0]const u8, noalias hints: ?*const std.c.addrinfo, callback: *const GetAddrInfoAsyncCallback, noalias context: ?*anyopaque) callconv(.c) i32;
    const GetaddrinfoAsyncHandleReply = fn (?*bun.mach_port) callconv(.c) i32;
    const GetaddrinfoAsyncCancel = fn (?*bun.mach_port) callconv(.c) void;

    var handle: ?*anyopaque = null;
    var loaded = false;
    pub fn getHandle() ?*anyopaque {
        if (loaded)
            return handle;
        loaded = true;
        handle = bun.sys.dlopen("libinfo.dylib", .{ .LAZY = true, .LOCAL = true });
        if (handle == null)
            Output.debug("libinfo.dylib not found", .{});
        return handle;
    }

    pub const getaddrinfo_async_start = struct {
        pub fn get() ?*const GetaddrinfoAsyncStart {
            bun.Environment.onlyMac();

            return bun.sys.dlsymWithHandle(*const GetaddrinfoAsyncStart, "getaddrinfo_async_start", getHandle);
        }
    }.get;

    pub const getaddrinfo_async_handle_reply = struct {
        pub fn get() ?*const GetaddrinfoAsyncHandleReply {
            bun.Environment.onlyMac();

            return bun.sys.dlsymWithHandle(*const GetaddrinfoAsyncHandleReply, "getaddrinfo_async_handle_reply", getHandle);
        }
    }.get;

    pub fn get() ?*const GetaddrinfoAsyncCancel {
        bun.Environment.onlyMac();

        return bun.C.dlsymWithHandle(*const GetaddrinfoAsyncCancel, "getaddrinfo_async_cancel", getHandle);
    }

    pub fn lookup(this: *Resolver, query: GetAddrInfo, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        bun.Environment.onlyMac();

        const getaddrinfo_async_start_ = LibInfo.getaddrinfo_async_start() orelse return LibC.lookup(this, query, globalThis);

        const key = GetAddrInfoRequest.PendingCacheKey.init(query);
        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_native);

        if (cache == .inflight) {
            var dns_lookup = bun.handleOom(DNSLookup.init(this, globalThis, globalThis.allocator()));

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
        ) catch |err| bun.handleOom(err);
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
            request.head.promise.rejectTask(globalThis, globalThis.createErrorInstance("getaddrinfo_async_start error: {s}", .{@tagName(bun.sys.getErrno(errno))})) catch {}; // TODO: properly propagate exception upwards
            if (request.cache.pending_cache) this.pending_host_cache_native.used.set(request.cache.pos_in_pending);
            this.vm.allocator.destroy(request);

            return promise_value;
        }

        bun.assert(request.backend.libinfo.machport != 0);
        var poll = bun.Async.FilePoll.init(
            this.vm,
            // TODO: WHAT?????????
            .fromNative(std.math.maxInt(i32) - 1),
            .{},
            GetAddrInfoRequest,
            request,
        );
        request.backend.libinfo.file_poll = poll;
        const rc = poll.registerWithFd(
            this.vm.event_loop_handle.?,
            .machport,
            .one_shot,
            .fromNative(@bitCast(request.backend.libinfo.machport)),
        );
        bun.assert(rc == .result);

        poll.enableKeepingProcessAlive(this.vm.eventLoop());
        this.requestSent(globalThis.bunVM());

        return promise_value;
    }
};

const LibC = struct {
    pub fn lookup(this: *Resolver, query_init: GetAddrInfo, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        if (Environment.isWindows) {
            @compileError("Do not use this path on Windows");
        }
        const key = GetAddrInfoRequest.PendingCacheKey.init(query_init);

        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_native);
        if (cache == .inflight) {
            var dns_lookup = bun.handleOom(DNSLookup.init(this, globalThis, globalThis.allocator()));

            cache.inflight.append(dns_lookup);

            return dns_lookup.promise.value();
        }

        const query = query_init.clone();

        var request = GetAddrInfoRequest.init(
            cache,
            .{ .libc = .{ .query = query } },
            this,
            query,
            globalThis,
            "pending_host_cache_native",
        ) catch |err| bun.handleOom(err);
        const promise_value = request.head.promise.value();

        var io = GetAddrInfoRequest.Task.createOnJSThread(this.vm.allocator, globalThis, request);

        io.schedule();
        this.requestSent(globalThis.bunVM());

        return promise_value;
    }
};

/// The windows implementation borrows the struct used for libc getaddrinfo
const LibUVBackend = struct {
    const log = Output.scoped(.LibUVBackend, .visible);

    fn onRawLibUVComplete(uv_info: *libuv.uv_getaddrinfo_t, _: c_int, _: ?*libuv.addrinfo) callconv(.c) void {
        //TODO: We schedule a task to run because otherwise the promise will not be solved, we need to investigate this
        const this: *GetAddrInfoRequest = @ptrCast(@alignCast(uv_info.data));
        const Holder = struct {
            uv_info: *libuv.uv_getaddrinfo_t,
            task: jsc.AnyTask,

            pub fn run(held: *@This()) void {
                defer bun.default_allocator.destroy(held);
                GetAddrInfoRequest.onLibUVComplete(held.uv_info);
            }
        };

        var holder = bun.handleOom(bun.default_allocator.create(Holder));
        holder.* = .{
            .uv_info = uv_info,
            .task = undefined,
        };
        holder.task = jsc.AnyTask.New(Holder, Holder.run).init(holder);

        this.head.globalThis.bunVM().enqueueTask(jsc.Task.init(&holder.task));
    }

    pub fn lookup(this: *Resolver, query: GetAddrInfo, globalThis: *jsc.JSGlobalObject) !jsc.JSValue {
        const key = GetAddrInfoRequest.PendingCacheKey.init(query);

        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_native);
        if (cache == .inflight) {
            var dns_lookup = bun.handleOom(DNSLookup.init(this, globalThis, globalThis.allocator()));

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
        ) catch |err| bun.handleOom(err);

        var hints = query.options.toLibC();
        var port_buf: [128]u8 = undefined;
        const port_len = std.fmt.printInt(&port_buf, query.port, 10, .lower, .{});
        port_buf[port_len] = 0;
        const portZ = port_buf[0..port_len :0];
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

        const log = Output.scoped(.ResolveInfoRequest, .hidden);

        resolver_for_caching: ?*Resolver = null,
        hash: u64 = 0,
        cache: @This().CacheConfig = @This().CacheConfig{},
        head: CAresLookup(cares_type, type_name),
        tail: *CAresLookup(cares_type, type_name) = undefined,

        pub fn init(
            cache: Resolver.LookupCacheHit(@This()),
            resolver: ?*Resolver,
            name: []const u8,
            globalThis: *jsc.JSGlobalObject,
            comptime cache_field: []const u8,
        ) !*@This() {
            var request = try globalThis.allocator().create(@This());
            var hasher = std.hash.Wyhash.init(0);
            hasher.update(name);
            const hash = hasher.final();
            var poll_ref = Async.KeepAlive.init();
            poll_ref.ref(globalThis.bunVM());
            if (resolver) |resolver_| resolver_.ref();
            request.* = .{
                .resolver_for_caching = resolver,
                .hash = hash,
                .head = .{
                    .resolver = resolver,
                    .poll_ref = poll_ref,
                    .globalThis = globalThis,
                    .promise = jsc.JSPromise.Strong.init(globalThis),
                    .allocated = false,
                    .name = name,
                },
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
                defer resolver.requestCompleted();
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

    const log = Output.scoped(@This(), .visible);

    resolver_for_caching: ?*Resolver = null,
    hash: u64 = 0,
    cache: @This().CacheConfig = @This().CacheConfig{},
    head: CAresReverse,
    tail: *CAresReverse = undefined,

    pub fn init(
        cache: Resolver.LookupCacheHit(@This()),
        resolver: ?*Resolver,
        name: []const u8,
        globalThis: *jsc.JSGlobalObject,
        comptime cache_field: []const u8,
    ) !*@This() {
        var request = try globalThis.allocator().create(@This());
        var hasher = std.hash.Wyhash.init(0);
        hasher.update(name);
        const hash = hasher.final();
        var poll_ref = Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());
        if (resolver) |resolver_| resolver_.ref();
        request.* = .{
            .resolver_for_caching = resolver,
            .hash = hash,
            .head = .{
                .resolver = resolver,
                .poll_ref = poll_ref,
                .globalThis = globalThis,
                .promise = jsc.JSPromise.Strong.init(globalThis),
                .allocated = false,
                .name = name,
            },
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
    const log = Output.scoped(.CAresNameInfo, .hidden);

    globalThis: *jsc.JSGlobalObject,
    promise: jsc.JSPromise.Strong,
    poll_ref: bun.Async.KeepAlive,
    allocated: bool = false,
    next: ?*@This() = null,
    name: []const u8,

    pub fn init(globalThis: *jsc.JSGlobalObject, allocator: std.mem.Allocator, name: []const u8) !*@This() {
        const this = try allocator.create(@This());
        var poll_ref = bun.Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());
        this.* = .{
            .globalThis = globalThis,
            .promise = jsc.JSPromise.Strong.init(globalThis),
            .poll_ref = poll_ref,
            .allocated = true,
            .name = name,
        };
        return this;
    }

    pub fn processResolve(this: *@This(), err_: ?c_ares.Error, _: i32, result: ?c_ares.struct_nameinfo) void {
        if (err_) |err| {
            err.toDeferred("getnameinfo", this.name, &this.promise).rejectLater(this.globalThis);
            this.deinit();
            return;
        }
        if (result == null) {
            c_ares.Error.ENOTFOUND.toDeferred("getnameinfo", this.name, &this.promise).rejectLater(this.globalThis);
            this.deinit();
            return;
        }
        var name_info = result.?;
        const array = name_info.toJSResponse(this.globalThis.allocator(), this.globalThis) catch .zero; // TODO: properly propagate exception upwards
        this.onComplete(array);
        return;
    }

    pub fn onComplete(this: *@This(), result: jsc.JSValue) void {
        var promise = this.promise;
        const globalThis = this.globalThis;
        this.promise = .{};
        promise.resolveTask(globalThis, result) catch {}; // TODO: properly propagate exception upwards
        this.deinit();
    }

    pub fn deinit(this: *@This()) void {
        this.poll_ref.unref(this.globalThis.bunVM());
        // freed
        bun.default_allocator.free(this.name);

        if (this.allocated) {
            this.globalThis.allocator().destroy(this);
        }
    }
};

pub const GetNameInfoRequest = struct {
    const request_type = @This();

    const log = Output.scoped(@This(), .visible);

    resolver_for_caching: ?*Resolver = null,
    hash: u64 = 0,
    cache: @This().CacheConfig = @This().CacheConfig{},
    head: CAresNameInfo,
    tail: *CAresNameInfo = undefined,

    pub fn init(
        cache: Resolver.LookupCacheHit(@This()),
        resolver: ?*Resolver,
        name: []const u8,
        globalThis: *jsc.JSGlobalObject,
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
            .head = .{ .poll_ref = poll_ref, .globalThis = globalThis, .promise = jsc.JSPromise.Strong.init(globalThis), .allocated = false, .name = name },
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
            defer resolver.requestCompleted();
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
    const log = Output.scoped(.GetAddrInfoRequest, .visible);

    backend: Backend = undefined,
    resolver_for_caching: ?*Resolver = null,
    hash: u64 = 0,
    cache: CacheConfig = CacheConfig{},
    head: DNSLookup,
    tail: *DNSLookup = undefined,
    task: bun.ThreadPool.Task = undefined,

    pub fn init(
        cache: Resolver.CacheHit,
        backend: Backend,
        resolver: ?*Resolver,
        query: GetAddrInfo,
        globalThis: *jsc.JSGlobalObject,
        comptime cache_field: []const u8,
    ) !*GetAddrInfoRequest {
        log("init", .{});
        var request = try globalThis.allocator().create(GetAddrInfoRequest);
        var poll_ref = Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());
        if (resolver) |resolver_| resolver_.ref();
        request.* = .{
            .backend = backend,
            .resolver_for_caching = resolver,
            .hash = query.hash(),
            .head = .{
                .resolver = resolver,
                .globalThis = globalThis,
                .poll_ref = poll_ref,
                .promise = jsc.JSPromise.Strong.init(globalThis),
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

    pub const Task = bun.jsc.WorkTask(GetAddrInfoRequest);

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
    ) callconv(.c) void {
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
                    const port_len = std.fmt.printInt(&port_buf, query.port, 10, .lower, .{});
                    port_buf[port_len] = 0;
                    const portZ = port_buf[0..port_len :0];
                    var hostname: bun.PathBuffer = undefined;
                    _ = strings.copy(hostname[0..], query.name);
                    hostname[query.name.len] = 0;
                    var addrinfo: ?*std.c.addrinfo = null;
                    const host = hostname[0..query.name.len :0];
                    const debug_timer = bun.Output.DebugTimer.start();
                    const err = std.c.getaddrinfo(
                        host.ptr,
                        if (port_len > 0) portZ.ptr else null,
                        if (hints) |*hint| hint else null,
                        &addrinfo,
                    );
                    bun.sys.syslog("getaddrinfo({s}, {s}) = {d} ({f})", .{
                        query.name,
                        portZ,
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

                    this.* = .{ .success = bun.handleOom(GetAddrInfo.Result.toList(default_allocator, addrinfo.?)) };
                }
            },

        pub const LibInfo = struct {
            file_poll: ?*bun.Async.FilePoll = null,
            machport: bun.mach_port = 0,

            extern fn getaddrinfo_send_reply(bun.mach_port, *const dns.LibInfo.GetaddrinfoAsyncHandleReply) bool;
            pub fn onMachportChange(this: *GetAddrInfoRequest) void {
                if (comptime !Environment.isMac)
                    unreachable;
                bun.jsc.markBinding(@src());

                if (!getaddrinfo_send_reply(this.backend.libinfo.machport, dns.LibInfo.getaddrinfo_async_handle_reply().?)) {
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

    pub fn then(this: *GetAddrInfoRequest, _: *jsc.JSGlobalObject) void {
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
        const this: *GetAddrInfoRequest = @ptrCast(@alignCast(uv_info.data));
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
    const log = Output.scoped(.CAresReverse, .visible);

    resolver: ?*Resolver,
    globalThis: *jsc.JSGlobalObject,
    promise: jsc.JSPromise.Strong,
    poll_ref: Async.KeepAlive,
    allocated: bool = false,
    next: ?*@This() = null,
    name: []const u8,

    pub fn init(resolver: ?*Resolver, globalThis: *jsc.JSGlobalObject, allocator: std.mem.Allocator, name: []const u8) !*@This() {
        if (resolver) |resolver_| {
            resolver_.ref();
        }

        const this = try allocator.create(@This());
        var poll_ref = Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());
        this.* = .{
            .resolver = resolver,
            .globalThis = globalThis,
            .promise = jsc.JSPromise.Strong.init(globalThis),
            .poll_ref = poll_ref,
            .allocated = true,
            .name = name,
        };
        return this;
    }

    pub fn processResolve(this: *@This(), err_: ?c_ares.Error, _: i32, result: ?*c_ares.struct_hostent) void {
        if (err_) |err| {
            err.toDeferred("getHostByAddr", this.name, &this.promise).rejectLater(this.globalThis);
            this.deinit();
            return;
        }
        if (result == null) {
            c_ares.Error.ENOTFOUND.toDeferred("getHostByAddr", this.name, &this.promise).rejectLater(this.globalThis);
            this.deinit();
            return;
        }
        var node = result.?;
        const array = node.toJSResponse(this.globalThis.allocator(), this.globalThis, "") catch .zero; // TODO: properly propagate exception upwards
        this.onComplete(array);
        return;
    }

    pub fn onComplete(this: *@This(), result: jsc.JSValue) void {
        var promise = this.promise;
        const globalThis = this.globalThis;
        this.promise = .{};
        promise.resolveTask(globalThis, result) catch {}; // TODO: properly propagate exception upwards
        if (this.resolver) |resolver| {
            resolver.requestCompleted();
        }
        this.deinit();
    }

    pub fn deinit(this: *@This()) void {
        this.poll_ref.unref(this.globalThis.bunVM());
        bun.default_allocator.free(this.name);

        if (this.resolver) |resolver| {
            resolver.deref();
        }

        if (this.allocated) {
            this.globalThis.allocator().destroy(this);
        }
    }
};

pub fn CAresLookup(comptime cares_type: type, comptime type_name: []const u8) type {
    return struct {
        const log = Output.scoped(.CAresLookup, .hidden);

        resolver: ?*Resolver,
        globalThis: *jsc.JSGlobalObject,
        promise: jsc.JSPromise.Strong,
        poll_ref: Async.KeepAlive,
        allocated: bool = false,
        next: ?*@This() = null,
        name: []const u8,

        pub fn new(data: @This()) *@This() {
            bun.assert(data.allocated); // deinit will not free this otherwise
            return bun.new(@This(), data);
        }

        pub fn init(resolver: ?*Resolver, globalThis: *jsc.JSGlobalObject, _: std.mem.Allocator, name: []const u8) !*@This() {
            if (resolver) |resolver_| {
                resolver_.ref();
            }

            var poll_ref = Async.KeepAlive.init();
            poll_ref.ref(globalThis.bunVM());
            return @This().new(
                .{
                    .resolver = resolver,
                    .globalThis = globalThis,
                    .promise = jsc.JSPromise.Strong.init(globalThis),
                    .poll_ref = poll_ref,
                    .allocated = true,
                    .name = name,
                },
            );
        }

        pub fn processResolve(this: *@This(), err_: ?c_ares.Error, _: i32, result: ?*cares_type) void {
            const syscall = comptime "query" ++ &[_]u8{std.ascii.toUpper(type_name[0])} ++ type_name[1..];

            if (err_) |err| {
                err.toDeferred(syscall, this.name, &this.promise).rejectLater(this.globalThis);
                this.deinit();
                return;
            }
            if (result == null) {
                c_ares.Error.ENOTFOUND.toDeferred(syscall, this.name, &this.promise).rejectLater(this.globalThis);
                this.deinit();
                return;
            }

            var node = result.?;
            const array = node.toJSResponse(this.globalThis.allocator(), this.globalThis, type_name) catch .zero; // TODO: properly propagate exception upwards
            this.onComplete(array);
            return;
        }

        pub fn onComplete(this: *@This(), result: jsc.JSValue) void {
            var promise = this.promise;
            const globalThis = this.globalThis;
            this.promise = .{};
            promise.resolveTask(globalThis, result) catch {}; // TODO: properly propagate exception upwards
            if (this.resolver) |resolver| {
                resolver.requestCompleted();
            }
            this.deinit();
        }

        pub fn deinit(this: *@This()) void {
            this.poll_ref.unref(this.globalThis.bunVM());
            bun.default_allocator.free(this.name);

            if (this.resolver) |resolver| {
                resolver.deref();
            }

            if (this.allocated) {
                bun.destroy(this);
            }
        }
    };
}

pub const DNSLookup = struct {
    const log = Output.scoped(.DNSLookup, .visible);

    resolver: ?*Resolver,
    globalThis: *jsc.JSGlobalObject = undefined,
    promise: jsc.JSPromise.Strong,
    allocated: bool = false,
    next: ?*DNSLookup = null,
    poll_ref: Async.KeepAlive,

    pub fn init(resolver: *Resolver, globalThis: *jsc.JSGlobalObject, allocator: std.mem.Allocator) !*DNSLookup {
        log("init", .{});
        resolver.ref();

        const this = try allocator.create(DNSLookup);
        var poll_ref = Async.KeepAlive.init();
        poll_ref.ref(globalThis.bunVM());

        this.* = .{
            .resolver = resolver,
            .globalThis = globalThis,
            .poll_ref = poll_ref,
            .promise = jsc.JSPromise.Strong.init(globalThis),
            .allocated = true,
        };
        return this;
    }

    pub fn onCompleteNative(this: *DNSLookup, result: GetAddrInfo.Result.Any) void {
        log("onCompleteNative", .{});
        const array = (result.toJS(this.globalThis) catch .zero).?; // TODO: properly propagate exception upwards
        this.onCompleteWithArray(array);
    }

    pub fn processGetAddrInfoNative(this: *DNSLookup, status: i32, result: ?*std.c.addrinfo) void {
        log("processGetAddrInfoNative: status={d}", .{status});
        if (c_ares.Error.initEAI(status)) |err| {
            err.toDeferred("getaddrinfo", null, &this.promise).rejectLater(this.globalThis);
            this.deinit();
            return;
        }
        onCompleteNative(this, .{ .addrinfo = result });
    }

    pub fn processGetAddrInfo(this: *DNSLookup, err_: ?c_ares.Error, _: i32, result: ?*c_ares.AddrInfo) void {
        log("processGetAddrInfo", .{});
        if (err_) |err| {
            err.toDeferred("getaddrinfo", null, &this.promise).rejectLater(this.globalThis);
            this.deinit();
            return;
        }

        if (result == null or result.?.node == null) {
            c_ares.Error.ENOTFOUND.toDeferred("getaddrinfo", null, &this.promise).rejectLater(this.globalThis);
            this.deinit();
            return;
        }
        this.onComplete(result.?);
    }

    pub fn onComplete(this: *DNSLookup, result: *c_ares.AddrInfo) void {
        log("onComplete", .{});

        const array = result.toJSArray(this.globalThis) catch .zero; // TODO: properly propagate exception upwards
        this.onCompleteWithArray(array);
    }

    pub fn onCompleteWithArray(this: *DNSLookup, result: jsc.JSValue) void {
        log("onCompleteWithArray", .{});

        var promise = this.promise;
        this.promise = .{};
        const globalThis = this.globalThis;
        promise.resolveTask(globalThis, result) catch {}; // TODO: properly propagate exception upwards
        if (this.resolver) |resolver| {
            resolver.requestCompleted();
        }
        this.deinit();
    }

    pub fn deinit(this: *DNSLookup) void {
        log("deinit", .{});
        this.poll_ref.unref(this.globalThis.bunVM());

        if (this.resolver) |resolver| {
            resolver.deref();
        }

        if (this.allocated) {
            this.globalThis.allocator().destroy(this);
        }
    }
};

pub const GlobalData = struct {
    resolver: Resolver,

    pub fn init(allocator: std.mem.Allocator, vm: *jsc.VirtualMachine) *GlobalData {
        const global = bun.handleOom(allocator.create(GlobalData));
        global.* = .{
            .resolver = Resolver.setup(allocator, vm),
        };

        return global;
    }
};

pub const internal = struct {
    const log = Output.scoped(.dns, .hidden);

    var __max_dns_time_to_live_seconds: ?u32 = null;
    pub fn getMaxDNSTimeToLiveSeconds() u32 {
        // This is racy, but it's okay because the number won't be invalid, just stale.
        return __max_dns_time_to_live_seconds orelse {
            const value = bun.env_var.BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS.get();
            __max_dns_time_to_live_seconds = @truncate(@as(u64, @intCast(value)));
            return __max_dns_time_to_live_seconds.?;
        };
    }

    pub const Request = struct {
        pub const new = bun.TrivialNew(@This());
        const Key = struct {
            host: ?[:0]const u8,
            port: u16 = 0, // Used for getaddrinfo() to avoid glibc UDP port 0 bug, but NOT included in hash
            hash: u64, // Hash of hostname only - DNS results are port-agnostic

            pub fn init(name: ?[:0]const u8, port: u16) @This() {
                const hash = if (name) |n| brk: {
                    break :brk generateHash(n); // Don't include port
                } else 0;
                return .{
                    .host = name,
                    .hash = hash,
                    .port = port,
                };
            }

            fn generateHash(name: [:0]const u8) u64 {
                return bun.hash(name);
            }

            pub fn toOwned(this: @This()) @This() {
                if (this.host) |host| {
                    const host_copy = bun.handleOom(bun.default_allocator.dupeZ(u8, host));
                    return .{
                        .host = host_copy,
                        .hash = this.hash,
                        .port = this.port,
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
            machport: bun.mach_port = 0,

            extern fn getaddrinfo_send_reply(bun.mach_port, *const dns.LibInfo.GetaddrinfoAsyncHandleReply) bool;
            pub fn onMachportChange(this: *Request) void {
                if (!getaddrinfo_send_reply(this.libinfo.machport, LibInfo.getaddrinfo_async_handle_reply().?)) {
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

        libinfo: if (Environment.isMac) MacAsyncDNS else void = if (Environment.isMac) .{},
        can_retry_for_addrconfig: bool = default_hints.flags.ADDRCONFIG,

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

            bun.destroy(this);
        }
    };

    const GlobalCache = struct {
        const MAX_ENTRIES = 256;

        lock: bun.Mutex = .{},
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
            return @truncate(bun.getRoughTickCountMs(.allow_mocked_time) / 1000);
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
    const default_hints: std.c.addrinfo = .{
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
        .flags = if (Environment.isPosix) .{ .ADDRCONFIG = true } else .{},
        .next = null,
        .protocol = 0,
        .socktype = std.c.SOCK.STREAM,
    };
    pub fn getHints() std.c.addrinfo {
        var hints_copy = default_hints;
        if (bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG.get()) {
            hints_copy.flags.ADDRCONFIG = false;
        }
        if (bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_IPV6.get()) {
            hints_copy.family = std.c.AF.INET;
        } else if (bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_IPV4.get()) {
            hints_copy.family = std.c.AF.INET6;
        }

        return hints_copy;
    }

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
                .socket => this.socket.loop(),
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

        var results = bun.handleOom(bun.default_allocator.alloc(ResultEntry, count));

        // copy results
        var i: usize = 0;
        info_ = info;
        while (info_) |ai| {
            results[i].info = ai.*;
            if (ai.addr) |addr| {
                if (ai.family == std.c.AF.INET) {
                    const addr_in: *std.c.sockaddr.in = @ptrCast(&results[i].addr);
                    addr_in.* = @as(*std.c.sockaddr.in, @ptrCast(@alignCast(addr))).*;
                } else if (ai.family == std.c.AF.INET6) {
                    const addr_in: *std.c.sockaddr.in6 = @ptrCast(&results[i].addr);
                    addr_in.* = @as(*std.c.sockaddr.in6, @ptrCast(@alignCast(addr))).*;
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
                entry.info.addr = @ptrCast(@alignCast(&entry.addr));
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
        var service_buf: [bun.fmt.fastDigitCount(std.math.maxInt(u16)) + 2]u8 = undefined;
        const service: ?[*:0]const u8 = if (req.key.port > 0)
            (std.fmt.bufPrintZ(&service_buf, "{d}", .{req.key.port}) catch unreachable).ptr
        else
            null;

        if (Environment.isWindows) {
            const wsa = std.os.windows.ws2_32;
            const wsa_hints = wsa.addrinfo{
                .flags = .{},
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
                service,
                &wsa_hints,
                &addrinfo,
            );
            afterResult(req, @ptrCast(addrinfo), err);
        } else {
            var addrinfo: ?*std.c.addrinfo = null;
            var hints = getHints();

            var err = std.c.getaddrinfo(
                if (req.key.host) |host| host.ptr else null,
                service,
                &hints,
                &addrinfo,
            );

            // optional fallback
            if (err == .NONAME and hints.flags.ADDRCONFIG) {
                hints.flags.ADDRCONFIG = false;
                req.can_retry_for_addrconfig = false;
                err = std.c.getaddrinfo(
                    if (req.key.host) |host| host.ptr else null,
                    service,
                    &hints,
                    &addrinfo,
                );
            }
            afterResult(req, addrinfo, @intFromEnum(err));
        }
    }

    pub fn lookupLibinfo(req: *Request, loop: jsc.EventLoopHandle) bool {
        const getaddrinfo_async_start_ = LibInfo.getaddrinfo_async_start() orelse return false;

        var machport: bun.mach_port = 0;
        var service_buf: [bun.fmt.fastDigitCount(std.math.maxInt(u16)) + 2]u8 = undefined;
        const service: ?[*:0]const u8 = if (req.key.port > 0)
            (std.fmt.bufPrintZ(&service_buf, "{d}", .{req.key.port}) catch unreachable).ptr
        else
            null;

        var hints = getHints();

        const errno = getaddrinfo_async_start_(
            &machport,
            if (req.key.host) |host| host.ptr else null,
            service,
            &hints,
            libinfoCallback,
            req,
        );

        if (errno != 0 or machport == 0) {
            return false;
        }

        var poll = bun.Async.FilePoll.init(loop, .fromNative(@bitCast(machport)), .{}, InternalDNSRequest, req);
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
    ) callconv(.c) void {
        const req: *Request = bun.cast(*Request, arg);
        const status_int: c_int = @intCast(status);
        if (status == @intFromEnum(std.c.EAI.NONAME) and req.can_retry_for_addrconfig) {
            req.can_retry_for_addrconfig = false;
            var service_buf: [bun.fmt.fastDigitCount(std.math.maxInt(u16)) + 2]u8 = undefined;
            const service: ?[*:0]const u8 = if (req.key.port > 0)
                (std.fmt.bufPrintZ(&service_buf, "{d}", .{req.key.port}) catch unreachable).ptr
            else
                null;
            const getaddrinfo_async_start_ = LibInfo.getaddrinfo_async_start() orelse return;
            var machport: bun.mach_port = 0;
            var hints = getHints();
            hints.flags.ADDRCONFIG = false;

            _ = getaddrinfo_async_start_(
                &machport,
                if (req.key.host) |host| host.ptr else null,
                service,
                &hints,
                libinfoCallback,
                req,
            );

            switch (req.libinfo.file_poll.?.register(bun.uws.Loop.get(), .machport, true)) {
                .err => log("libinfoCallback: failed to register poll", .{}),
                .result => {
                    return;
                },
            }
        }
        afterResult(req, addr_info, @intCast(status_int));
    }

    var dns_cache_hits_completed: usize = 0;
    var dns_cache_hits_inflight: usize = 0;
    var dns_cache_size: usize = 0;
    var dns_cache_misses: usize = 0;
    var dns_cache_errors: usize = 0;
    var getaddrinfo_calls: usize = 0;

    pub fn getDNSCacheStats(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const object = jsc.JSValue.createEmptyObject(globalObject, 6);
        object.put(globalObject, jsc.ZigString.static("cacheHitsCompleted"), jsc.JSValue.jsNumber(@atomicLoad(usize, &dns_cache_hits_completed, .monotonic)));
        object.put(globalObject, jsc.ZigString.static("cacheHitsInflight"), jsc.JSValue.jsNumber(@atomicLoad(usize, &dns_cache_hits_inflight, .monotonic)));
        object.put(globalObject, jsc.ZigString.static("cacheMisses"), jsc.JSValue.jsNumber(@atomicLoad(usize, &dns_cache_misses, .monotonic)));
        object.put(globalObject, jsc.ZigString.static("size"), jsc.JSValue.jsNumber(@atomicLoad(usize, &dns_cache_size, .monotonic)));
        object.put(globalObject, jsc.ZigString.static("errors"), jsc.JSValue.jsNumber(@atomicLoad(usize, &dns_cache_errors, .monotonic)));
        object.put(globalObject, jsc.ZigString.static("totalCount"), jsc.JSValue.jsNumber(@atomicLoad(usize, &getaddrinfo_calls, .monotonic)));
        return object;
    }

    pub fn getaddrinfo(loop: *bun.uws.Loop, host: ?[:0]const u8, port: u16, is_cache_hit: ?*bool) ?*Request {
        const preload = is_cache_hit == null;
        const key = Request.Key.init(host, port);
        global_cache.lock.lock();
        getaddrinfo_calls += 1;
        var timestamp_to_store: u32 = 0;
        // is there a cache hit?
        if (!bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_DNS_CACHE.get()) {
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
            if (!bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO.get()) {
                const res = lookupLibinfo(req, loop.internal_loop_data.getParent());
                log("getaddrinfo({s}) = cache miss (libinfo)", .{host orelse ""});
                if (res) return req;
                // if we were not able to use libinfo, we fall back to the work pool
            }
        }

        log("getaddrinfo({s}) = cache miss (libc)", .{host orelse ""});
        // schedule the request to be executed on the work pool
        bun.handleOom(bun.jsc.WorkPool.go(bun.default_allocator, *Request, req, workPoolCallback));
        return req;
    }

    pub fn prefetchFromJS(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments();

        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("prefetch", 1, arguments.len);
        }

        const hostname_or_url = arguments[0];

        var hostname_slice = jsc.ZigString.Slice.empty;
        defer hostname_slice.deinit();

        if (hostname_or_url.isString()) {
            hostname_slice = try hostname_or_url.toSlice(globalThis, bun.default_allocator);
        } else {
            return globalThis.throwInvalidArguments("hostname must be a string", .{});
        }

        const hostname_z = try bun.default_allocator.dupeZ(u8, hostname_slice.slice());
        defer bun.default_allocator.free(hostname_z);

        const port: u16 = brk: {
            if (arguments.len > 1 and !arguments[1].isUndefinedOrNull()) {
                break :brk try globalThis.validateIntegerRange(arguments[1], u16, 443, .{ .field_name = "port", .always_allow_zero = true });
            } else {
                break :brk 443;
            }
        };

        prefetch(jsc.VirtualMachine.get().uwsLoop(), hostname_z, port);
        return .js_undefined;
    }

    pub fn prefetch(loop: *bun.uws.Loop, hostname: ?[:0]const u8, port: u16) void {
        _ = getaddrinfo(loop, hostname, port, null);
    }

    fn us_getaddrinfo(loop: *bun.uws.Loop, _host: ?[*:0]const u8, port: u16, socket: *?*anyopaque) callconv(.c) c_int {
        const host: ?[:0]const u8 = std.mem.span(_host);
        var is_cache_hit: bool = false;
        const req = getaddrinfo(loop, host, port, &is_cache_hit).?;
        socket.* = req;
        return if (is_cache_hit) 0 else 1;
    }

    fn us_getaddrinfo_set(
        request: *Request,
        socket: *bun.uws.ConnectingSocket,
    ) callconv(.c) void {
        global_cache.lock.lock();
        defer global_cache.lock.unlock();
        const query = DNSRequestOwner{
            .socket = socket,
        };
        if (request.result != null) {
            query.notify(request);
            return;
        }

        bun.handleOom(request.notify.append(bun.default_allocator, .{ .socket = socket }));
    }

    fn freeaddrinfo(req: *Request, err: c_int) callconv(.c) void {
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

    fn getRequestResult(req: *Request) callconv(.c) *Request.Result {
        return &req.result.?;
    }
};

pub const InternalDNSRequest = internal.Request;

comptime {
    @export(&internal.us_getaddrinfo_set, .{
        .name = "Bun__addrinfo_set",
    });
    @export(&internal.us_getaddrinfo, .{
        .name = "Bun__addrinfo_get",
    });
    @export(&internal.freeaddrinfo, .{
        .name = "Bun__addrinfo_freeRequest",
    });
    @export(&internal.getRequestResult, .{
        .name = "Bun__addrinfo_getRequestResult",
    });
}

pub const Resolver = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    const log = Output.scoped(.DNSResolver, .visible);

    ref_count: RefCount,
    channel: ?*c_ares.Channel = null,
    vm: *jsc.VirtualMachine,
    polls: PollsMap,
    options: c_ares.ChannelOptions = .{},

    event_loop_timer: EventLoopTimer = .{
        .next = .epoch,
        .tag = .DNSResolver,
    },

    pending_host_cache_cares: PendingCache,
    pending_host_cache_native: PendingCache,
    pending_srv_cache_cares: SrvPendingCache,
    pending_soa_cache_cares: SoaPendingCache,
    pending_txt_cache_cares: TxtPendingCache,
    pending_naptr_cache_cares: NaptrPendingCache,
    pending_mx_cache_cares: MxPendingCache,
    pending_caa_cache_cares: CaaPendingCache,
    pending_ns_cache_cares: NSPendingCache,
    pending_ptr_cache_cares: PtrPendingCache,
    pending_cname_cache_cares: CnamePendingCache,
    pending_a_cache_cares: APendingCache,
    pending_aaaa_cache_cares: AAAAPendingCache,
    pending_any_cache_cares: AnyPendingCache,
    pending_addr_cache_cares: AddrPendingCache,
    pending_nameinfo_cache_cares: NameInfoPendingCache,

    pub const js = jsc.Codegen.JSDNSResolver;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    const PollsMap = std.AutoArrayHashMap(c_ares.ares_socket_t, *PollType);

    const PollType = if (Environment.isWindows)
        UvDnsPoll
    else
        Async.FilePoll;

    const UvDnsPoll = struct {
        pub const new = bun.TrivialNew(@This());
        pub const destroy = bun.TrivialDeinit(@This());

        parent: *Resolver,
        socket: c_ares.ares_socket_t,
        poll: bun.windows.libuv.uv_poll_t,

        pub fn fromPoll(poll: *bun.windows.libuv.uv_poll_t) *UvDnsPoll {
            return @fieldParentPtr("poll", poll);
        }
    };

    pub fn setup(allocator: std.mem.Allocator, vm: *jsc.VirtualMachine) Resolver {
        return .{
            .ref_count = .init(),
            .vm = vm,
            .polls = Resolver.PollsMap.init(allocator),
            .pending_host_cache_cares = PendingCache.empty,
            .pending_host_cache_native = PendingCache.empty,
            .pending_srv_cache_cares = SrvPendingCache.empty,
            .pending_soa_cache_cares = SoaPendingCache.empty,
            .pending_txt_cache_cares = TxtPendingCache.empty,
            .pending_naptr_cache_cares = NaptrPendingCache.empty,
            .pending_mx_cache_cares = MxPendingCache.empty,
            .pending_caa_cache_cares = CaaPendingCache.empty,
            .pending_ns_cache_cares = NSPendingCache.empty,
            .pending_ptr_cache_cares = PtrPendingCache.empty,
            .pending_cname_cache_cares = CnamePendingCache.empty,
            .pending_a_cache_cares = APendingCache.empty,
            .pending_aaaa_cache_cares = AAAAPendingCache.empty,
            .pending_any_cache_cares = AnyPendingCache.empty,
            .pending_addr_cache_cares = AddrPendingCache.empty,
            .pending_nameinfo_cache_cares = NameInfoPendingCache.empty,
        };
    }

    pub fn init(allocator: std.mem.Allocator, vm: *jsc.VirtualMachine) *Resolver {
        log("init", .{});
        return bun.new(Resolver, .setup(allocator, vm));
    }

    pub fn finalize(this: *Resolver) void {
        this.deref();
    }

    fn deinit(this: *Resolver) void {
        if (this.channel) |channel| {
            channel.deinit();
        }

        bun.destroy(this);
    }

    pub const Order = enum(u8) {
        verbatim = 0,
        ipv4first = 4,
        ipv6first = 6,

        pub const default = .verbatim;

        pub const map = bun.ComptimeStringMap(Order, .{
            .{ "verbatim", .verbatim },
            .{ "ipv4first", .ipv4first },
            .{ "ipv6first", .ipv6first },
            .{ "0", .verbatim },
            .{ "4", .ipv4first },
            .{ "6", .ipv6first },
        });

        pub fn toJS(this: Order, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
            return jsc.ZigString.init(@tagName(this)).toJS(globalThis);
        }

        pub fn fromString(order: []const u8) ?Order {
            return Order.map.get(order);
        }

        pub fn fromStringOrDie(order: []const u8) Order {
            return fromString(order) orelse {
                Output.prettyErrorln("<r><red>error<r><d>:<r> Invalid DNS result order.", .{});
                Global.exit(1);
            };
        }
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
    const APendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.hostent_with_ttls, "a").PendingCacheKey, 32);
    const AAAAPendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.hostent_with_ttls, "aaaa").PendingCacheKey, 32);
    const AnyPendingCache = bun.HiveArray(ResolveInfoRequest(c_ares.struct_any_reply, "any").PendingCacheKey, 32);
    const AddrPendingCache = bun.HiveArray(GetHostByAddrInfoRequest.PendingCacheKey, 32);
    const NameInfoPendingCache = bun.HiveArray(GetNameInfoRequest.PendingCacheKey, 32);

    pub fn checkTimeouts(this: *Resolver, now: *const timespec, vm: *jsc.VirtualMachine) void {
        defer {
            vm.timer.incrementTimerRef(-1);
            this.deref();
        }

        this.event_loop_timer.state = .PENDING;

        if (this.getChannelOrError(vm.global)) |channel| {
            if (this.anyRequestsPending()) {
                c_ares.ares_process_fd(channel, c_ares.ARES_SOCKET_BAD, c_ares.ARES_SOCKET_BAD);
                _ = this.addTimer(now);
            }
        } else |_| {}
    }

    fn anyRequestsPending(this: *Resolver) bool {
        inline for (@typeInfo(Resolver).@"struct".fields) |field| {
            if (comptime std.mem.startsWith(u8, field.name, "pending_")) {
                const set = &@field(this, field.name).used;
                if (set.findFirstSet() != null) {
                    return true;
                }
            }
        }
        return false;
    }

    fn requestSent(this: *Resolver, _: *jsc.VirtualMachine) void {
        _ = this.addTimer(null);
    }

    fn requestCompleted(this: *Resolver) void {
        if (this.anyRequestsPending()) {
            _ = this.addTimer(null);
        } else {
            this.removeTimer();
        }
    }

    fn addTimer(this: *Resolver, now: ?*const timespec) bool {
        if (this.event_loop_timer.state == .ACTIVE) {
            return false;
        }

        this.ref();
        this.event_loop_timer.next = (now orelse &timespec.now(.allow_mocked_time)).addMs(1000);
        this.vm.timer.incrementTimerRef(1);
        this.vm.timer.insert(&this.event_loop_timer);
        return true;
    }

    fn removeTimer(this: *Resolver) void {
        if (this.event_loop_timer.state != .ACTIVE) {
            return;
        }

        // Normally checkTimeouts does this, so we have to be sure to do it ourself if we cancel the timer
        defer {
            this.vm.timer.incrementTimerRef(-1);
            this.deref();
        }

        this.vm.timer.remove(&this.event_loop_timer);
    }

    fn getKey(this: *Resolver, index: u8, comptime cache_name: []const u8, comptime request_type: type) request_type.PendingCacheKey {
        var cache = &@field(this, cache_name);
        bun.assert(cache.used.isSet(index));
        const entry = cache.buffer[index];
        cache.buffer[index] = undefined;

        var used = cache.used;
        used.unset(index);
        cache.used = used;

        return entry;
    }

    pub fn drainPendingCares(this: *Resolver, index: u8, err: ?c_ares.Error, timeout: i32, comptime request_type: type, comptime cares_type: type, comptime lookup_name: []const u8, result: ?*cares_type) void {
        const cache_name = comptime std.fmt.comptimePrint("pending_{s}_cache_cares", .{lookup_name});

        this.ref();
        defer this.deref();

        const key = this.getKey(index, cache_name, request_type);

        var addr: *cares_type = result orelse {
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
        var array = addr.toJSResponse(this.vm.allocator, prev_global, lookup_name) catch .zero; // TODO: properly propagate exception upwards
        defer addr.deinit();
        array.ensureStillAlive();
        key.lookup.head.onComplete(array);
        bun.default_allocator.destroy(key.lookup);

        array.ensureStillAlive();

        while (pending) |value| {
            const new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addr.toJSResponse(this.vm.allocator, new_global, lookup_name) catch .zero; // TODO: properly propagate exception upwards
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

    pub fn drainPendingHostCares(this: *Resolver, index: u8, err: ?c_ares.Error, timeout: i32, result: ?*c_ares.AddrInfo) void {
        const key = this.getKey(index, "pending_host_cache_cares", GetAddrInfoRequest);

        this.ref();
        defer this.deref();

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
        var array = addr.toJSArray(prev_global) catch .zero; // TODO: properly propagate exception upwards
        defer addr.deinit();
        array.ensureStillAlive();
        key.lookup.head.onCompleteWithArray(array);
        bun.default_allocator.destroy(key.lookup);

        array.ensureStillAlive();
        // std.c.addrinfo

        while (pending) |value| {
            const new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addr.toJSArray(new_global) catch .zero; // TODO: properly propagate exception upwards
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

    pub fn drainPendingHostNative(this: *Resolver, index: u8, globalObject: *jsc.JSGlobalObject, err: i32, result: GetAddrInfo.Result.Any) void {
        log("drainPendingHostNative", .{});
        const key = this.getKey(index, "pending_host_cache_native", GetAddrInfoRequest);

        this.ref();
        defer this.deref();

        var array = (result.toJS(globalObject) catch .zero) orelse { // TODO: properly propagate exception upwards
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
                array = (result.toJS(new_global) catch .zero).?; // TODO: properly propagate exception upwards
                prev_global = new_global;
            }

            {
                array.ensureStillAlive();
                value.onCompleteWithArray(array);
                array.ensureStillAlive();
            }
        }
    }

    pub fn drainPendingAddrCares(this: *Resolver, index: u8, err: ?c_ares.Error, timeout: i32, result: ?*c_ares.struct_hostent) void {
        const key = this.getKey(index, "pending_addr_cache_cares", GetHostByAddrInfoRequest);

        this.ref();
        defer this.deref();

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
        var array = addr.toJSResponse(this.vm.allocator, prev_global, "") catch .zero; // TODO: properly propagate exception upwards
        array.ensureStillAlive();
        key.lookup.head.onComplete(array);
        bun.default_allocator.destroy(key.lookup);

        array.ensureStillAlive();

        while (pending) |value| {
            const new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addr.toJSResponse(this.vm.allocator, new_global, "") catch .zero; // TODO: properly propagate exception upwards
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

    pub fn drainPendingNameInfoCares(this: *Resolver, index: u8, err: ?c_ares.Error, timeout: i32, result: ?c_ares.struct_nameinfo) void {
        const key = this.getKey(index, "pending_nameinfo_cache_cares", GetNameInfoRequest);

        this.ref();
        defer this.deref();

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

        var array = name_info.toJSResponse(this.vm.allocator, prev_global) catch .zero; // TODO: properly propagate exception upwards
        array.ensureStillAlive();
        key.lookup.head.onComplete(array);
        bun.default_allocator.destroy(key.lookup);

        array.ensureStillAlive();

        while (pending) |value| {
            const new_global = value.globalThis;
            if (prev_global != new_global) {
                array = name_info.toJSResponse(this.vm.allocator, new_global) catch .zero; // TODO: properly propagate exception upwards
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
        this: *Resolver,
        comptime request_type: type,
        key: request_type.PendingCacheKey,
        comptime field: []const u8,
    ) LookupCacheHit(request_type) {
        var cache = &@field(this, field);
        var inflight_iter = cache.used.iterator(
            .{
                .kind = .set,
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
        this: *Resolver,
        key: GetAddrInfoRequest.PendingCacheKey,
        comptime field: std.meta.FieldEnum(Resolver),
    ) CacheHit {
        var cache: *PendingCache = &@field(this, @tagName(field));
        var inflight_iter = cache.used.iterator(
            .{
                .kind = .set,
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
    pub fn getChannel(this: *Resolver) ChannelResult {
        if (this.channel == null) {
            if (c_ares.Channel.init(Resolver, this, this.options)) |err| {
                return .{ .err = err };
            }
        }

        return .{ .result = this.channel.? };
    }

    fn getChannelFromVM(globalThis: *jsc.JSGlobalObject) bun.JSError!*c_ares.Channel {
        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.getChannelOrError(globalThis);
    }

    pub fn getChannelOrError(this: *Resolver, globalThis: *jsc.JSGlobalObject) bun.JSError!*c_ares.Channel {
        switch (this.getChannel()) {
            .result => |result| return result,
            .err => |err| {
                const system_error = jsc.SystemError{
                    .errno = -1,
                    .code = bun.String.static(err.code()),
                    .message = bun.String.static(err.label()),
                };

                return globalThis.throwValue(system_error.toErrorInstance(globalThis));
            },
        }
    }

    pub fn onDNSPollUv(watcher: [*c]bun.windows.libuv.uv_poll_t, status: c_int, events: c_int) callconv(.c) void {
        const poll = UvDnsPoll.fromPoll(watcher);
        const vm = poll.parent.vm;
        vm.eventLoop().enter();
        defer vm.eventLoop().exit();
        poll.parent.ref();
        defer poll.parent.deref();
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

    pub fn onCloseUv(watcher: *anyopaque) callconv(.c) void {
        const poll = UvDnsPoll.fromPoll(@ptrCast(@alignCast(watcher)));
        poll.destroy();
    }

    pub fn onDNSPoll(
        this: *Resolver,
        poll: *Async.FilePoll,
    ) void {
        var vm = this.vm;
        vm.eventLoop().enter();
        defer vm.eventLoop().exit();
        var channel = this.channel orelse {
            _ = this.polls.orderedRemove(poll.fd.native());
            poll.deinit();
            return;
        };

        this.ref();
        defer this.deref();

        channel.process(
            poll.fd.native(),
            poll.isReadable(),
            poll.isWritable(),
        );
    }

    pub fn onDNSSocketState(
        this: *Resolver,
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

            const poll_entry = bun.handleOom(this.polls.getOrPut(fd));
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
                poll_entry.value_ptr.* = Async.FilePoll.init(vm, .fromNative(fd), .{}, Resolver, this);
            }

            var poll = poll_entry.value_ptr.*;

            if (readable and !poll.flags.contains(.poll_readable))
                _ = poll.register(vm.event_loop_handle.?, .readable, false);

            if (writable and !poll.flags.contains(.poll_writable))
                _ = poll.register(vm.event_loop_handle.?, .writable, false);
        }
    }

    const DNSQuery = struct {
        name: jsc.ZigString.Slice,
        record_type: RecordType,

        ttl: i32 = 0,
    };

    pub const RecordType = enum(c_int) {
        A = 1,
        AAAA = 28,
        CAA = 257,
        CNAME = 5,
        MX = 15,
        NS = 2,
        PTR = 12,
        SOA = 6,
        SRV = 33,
        TXT = 16,
        ANY = 255,

        pub const default = RecordType.A;

        pub const map = bun.ComptimeStringMap(RecordType, .{
            .{ "A", .A },
            .{ "AAAA", .AAAA },
            .{ "ANY", .ANY },
            .{ "CAA", .CAA },
            .{ "CNAME", .CNAME },
            .{ "MX", .MX },
            .{ "NS", .NS },
            .{ "PTR", .PTR },
            .{ "SOA", .SOA },
            .{ "SRV", .SRV },
            .{ "TXT", .TXT },
            .{ "a", .A },
            .{ "aaaa", .AAAA },
            .{ "any", .ANY },
            .{ "caa", .CAA },
            .{ "cname", .CNAME },
            .{ "mx", .MX },
            .{ "ns", .NS },
            .{ "ptr", .PTR },
            .{ "soa", .SOA },
            .{ "srv", .SRV },
            .{ "txt", .TXT },
        });
    };

    pub fn globalResolve(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolve(globalThis, callframe);
    }

    pub fn resolve(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(3);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolve", 3, arguments.len);
        }

        const record_type: RecordType = if (arguments.len <= 1)
            RecordType.default
        else brk: {
            const record_type_value = arguments.ptr[1];
            if (record_type_value.isEmptyOrUndefinedOrNull() or !record_type_value.isString()) {
                break :brk RecordType.default;
            }

            const record_type_str = try record_type_value.toJSString(globalThis);
            if (record_type_str.length() == 0) {
                break :brk RecordType.default;
            }

            break :brk RecordType.map.getWithEql(record_type_str.getZigString(globalThis), jsc.ZigString.eqlComptime) orelse {
                return globalThis.throwInvalidArgumentPropertyValue("record", "one of: A, AAAA, ANY, CAA, CNAME, MX, NS, PTR, SOA, SRV, TXT", record_type_value);
            };
        };

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolve", "name", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        if (name_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("resolve", "name", "non-empty string");
        }

        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);

        switch (record_type) {
            RecordType.A => {
                return this.doResolveCAres(c_ares.hostent_with_ttls, "a", name.slice(), globalThis);
            },
            RecordType.AAAA => {
                return this.doResolveCAres(c_ares.hostent_with_ttls, "aaaa", name.slice(), globalThis);
            },
            RecordType.ANY => {
                return this.doResolveCAres(c_ares.struct_any_reply, "any", name.slice(), globalThis);
            },
            RecordType.CAA => {
                return this.doResolveCAres(c_ares.struct_ares_caa_reply, "caa", name.slice(), globalThis);
            },
            RecordType.CNAME => {
                return this.doResolveCAres(c_ares.struct_hostent, "cname", name.slice(), globalThis);
            },
            RecordType.MX => {
                return this.doResolveCAres(c_ares.struct_ares_mx_reply, "mx", name.slice(), globalThis);
            },
            RecordType.NS => {
                return this.doResolveCAres(c_ares.struct_hostent, "ns", name.slice(), globalThis);
            },
            RecordType.PTR => {
                return this.doResolveCAres(c_ares.struct_hostent, "ptr", name.slice(), globalThis);
            },
            RecordType.SOA => {
                return this.doResolveCAres(c_ares.struct_ares_soa_reply, "soa", name.slice(), globalThis);
            },
            RecordType.SRV => {
                return this.doResolveCAres(c_ares.struct_ares_srv_reply, "srv", name.slice(), globalThis);
            },
            RecordType.TXT => {
                return this.doResolveCAres(c_ares.struct_ares_txt_reply, "txt", name.slice(), globalThis);
            },
        }
    }

    pub fn globalReverse(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.reverse(globalThis, callframe);
    }

    pub fn reverse(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("reverse", 1, arguments.len);
        }

        const ip_value = arguments.ptr[0];
        if (ip_value.isEmptyOrUndefinedOrNull() or !ip_value.isString()) {
            return globalThis.throwInvalidArgumentType("reverse", "ip", "string");
        }

        const ip_str = try ip_value.toJSString(globalThis);
        if (ip_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("reverse", "ip", "non-empty string");
        }

        const ip_slice = try ip_str.toSliceClone(globalThis, bun.default_allocator);
        const ip = ip_slice.slice();
        const channel: *c_ares.Channel = switch (this.getChannel()) {
            .result => |res| res,
            .err => |err| {
                return globalThis.throwValue(try err.toJSWithSyscallAndHostname(globalThis, "getHostByAddr", ip));
            },
        };

        const key = GetHostByAddrInfoRequest.PendingCacheKey.init(ip);
        var cache = this.getOrPutIntoResolvePendingCache(
            GetHostByAddrInfoRequest,
            key,
            "pending_addr_cache_cares",
        );
        if (cache == .inflight) {
            var cares_reverse = bun.handleOom(CAresReverse.init(this, globalThis, globalThis.allocator(), ip));
            cache.inflight.append(cares_reverse);
            return cares_reverse.promise.value();
        }

        var request = GetHostByAddrInfoRequest.init(
            cache,
            this,
            ip,
            globalThis,
            "pending_addr_cache_cares",
        ) catch |err| bun.handleOom(err);

        const promise = request.tail.promise.value();
        channel.getHostByAddr(
            ip,
            GetHostByAddrInfoRequest,
            request,
            GetHostByAddrInfoRequest.onCaresComplete,
        );

        this.requestSent(globalThis.bunVM());
        return promise;
    }

    pub fn globalLookup(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("lookup", 2, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("lookup", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        if (name_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("lookup", "hostname", "non-empty string");
        }

        var options = GetAddrInfo.Options{};
        var port: u16 = 0;

        if (arguments.len > 1 and arguments.ptr[1].isCell()) {
            const optionsObject = arguments.ptr[1];

            if (try optionsObject.getTruthy(globalThis, "port")) |port_value| {
                port = try port_value.toPortNumber(globalThis);
            }

            options = GetAddrInfo.Options.fromJS(optionsObject, globalThis) catch |err| {
                return switch (err) {
                    error.InvalidFlags => globalThis.throwInvalidArgumentValue("flags", try optionsObject.getTruthy(globalThis, "flags") orelse .js_undefined),
                    error.JSError => |exception| exception,
                    error.OutOfMemory => |oom| oom,
                    error.JSTerminated => |e| e,

                    // more information with these errors
                    error.InvalidOptions,
                    error.InvalidFamily,
                    error.InvalidSocketType,
                    error.InvalidProtocol,
                    error.InvalidBackend,
                    => globalThis.throw("Invalid options passed to lookup(): {s}", .{@errorName(err)}),
                };
            };
        }

        const name = name_str.toSlice(globalThis, bun.default_allocator);
        defer name.deinit();
        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doLookup(name.slice(), port, options, globalThis);
    }

    pub fn doLookup(this: *Resolver, name: []const u8, port: u16, options: GetAddrInfo.Options, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
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

    pub fn globalResolveSrv(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolveSrv(globalThis, callframe);
    }

    pub fn resolveSrv(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolveSrv", 1, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolveSrv", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        if (name_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("resolveSrv", "hostname", "non-empty string");
        }

        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);
        return this.doResolveCAres(c_ares.struct_ares_srv_reply, "srv", name.slice(), globalThis);
    }

    pub fn globalResolveSoa(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolveSoa(globalThis, callframe);
    }

    pub fn resolveSoa(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolveSoa", 1, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolveSoa", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);
        return this.doResolveCAres(c_ares.struct_ares_soa_reply, "soa", name.slice(), globalThis);
    }

    pub fn globalResolveCaa(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolveCaa(globalThis, callframe);
    }

    pub fn resolveCaa(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolveCaa", 1, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolveCaa", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        if (name_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("resolveCaa", "hostname", "non-empty string");
        }

        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);
        return this.doResolveCAres(c_ares.struct_ares_caa_reply, "caa", name.slice(), globalThis);
    }

    pub fn globalResolveNs(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolveNs(globalThis, callframe);
    }

    pub fn resolveNs(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolveNs", 1, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolveNs", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);

        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);
        return this.doResolveCAres(c_ares.struct_hostent, "ns", name.slice(), globalThis);
    }

    pub fn globalResolvePtr(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolvePtr(globalThis, callframe);
    }

    pub fn resolvePtr(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolvePtr", 1, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolvePtr", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        if (name_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("resolvePtr", "hostname", "non-empty string");
        }

        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);
        return this.doResolveCAres(c_ares.struct_hostent, "ptr", name.slice(), globalThis);
    }

    pub fn globalResolveCname(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolveCname(globalThis, callframe);
    }

    pub fn resolveCname(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolveCname", 1, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolveCname", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        if (name_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("resolveCname", "hostname", "non-empty string");
        }

        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);
        return this.doResolveCAres(c_ares.struct_hostent, "cname", name.slice(), globalThis);
    }

    pub fn globalResolveMx(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolveMx(globalThis, callframe);
    }

    pub fn resolveMx(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolveMx", 1, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolveMx", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        if (name_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("resolveMx", "hostname", "non-empty string");
        }

        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);
        return this.doResolveCAres(c_ares.struct_ares_mx_reply, "mx", name.slice(), globalThis);
    }

    pub fn globalResolveNaptr(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolveNaptr(globalThis, callframe);
    }

    pub fn resolveNaptr(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolveNaptr", 1, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolveNaptr", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        if (name_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("resolveNaptr", "hostname", "non-empty string");
        }

        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);
        return this.doResolveCAres(c_ares.struct_ares_naptr_reply, "naptr", name.slice(), globalThis);
    }

    pub fn globalResolveTxt(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolveTxt(globalThis, callframe);
    }

    pub fn resolveTxt(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(1);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolveTxt", 1, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolveTxt", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        if (name_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("resolveTxt", "hostname", "non-empty string");
        }

        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);
        return this.doResolveCAres(c_ares.struct_ares_txt_reply, "txt", name.slice(), globalThis);
    }

    pub fn globalResolveAny(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vm = globalThis.bunVM();
        const resolver = vm.rareData().globalDNSResolver(vm);
        return resolver.resolveAny(globalThis, callframe);
    }

    pub fn resolveAny(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(1);
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("resolveAny", 1, arguments.len);
        }

        const name_value = arguments.ptr[0];

        if (name_value.isEmptyOrUndefinedOrNull() or !name_value.isString()) {
            return globalThis.throwInvalidArgumentType("resolveAny", "hostname", "string");
        }

        const name_str = try name_value.toJSString(globalThis);
        if (name_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("resolveAny", "hostname", "non-empty string");
        }

        const name = try name_str.toSliceClone(globalThis, bun.default_allocator);
        return this.doResolveCAres(c_ares.struct_any_reply, "any", name.slice(), globalThis);
    }

    pub fn doResolveCAres(this: *Resolver, comptime cares_type: type, comptime type_name: []const u8, name: []const u8, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        var channel: *c_ares.Channel = switch (this.getChannel()) {
            .result => |res| res,
            .err => |err| {
                return globalThis.throwValue(try err.toJSWithSyscall(globalThis, "query" ++ &[_]u8{std.ascii.toUpper(type_name[0])} ++ type_name[1..]));
            },
        };

        const cache_name = comptime std.fmt.comptimePrint("pending_{s}_cache_cares", .{type_name});

        const key = ResolveInfoRequest(cares_type, type_name).PendingCacheKey.init(name);

        var cache = this.getOrPutIntoResolvePendingCache(ResolveInfoRequest(cares_type, type_name), key, cache_name);
        if (cache == .inflight) {
            // CAresLookup will have the name ownership
            var cares_lookup = bun.handleOom(CAresLookup(cares_type, type_name).init(this, globalThis, globalThis.allocator(), name));
            cache.inflight.append(cares_lookup);
            return cares_lookup.promise.value();
        }

        var request = ResolveInfoRequest(cares_type, type_name).init(
            cache,
            this,
            name, // CAresLookup will have the ownership
            globalThis,
            cache_name,
        ) catch |err| bun.handleOom(err);
        const promise = request.tail.promise.value();

        channel.resolve(
            name,
            type_name,
            ResolveInfoRequest(cares_type, type_name),
            request,
            cares_type,
            ResolveInfoRequest(cares_type, type_name).onCaresComplete,
        );

        this.requestSent(globalThis.bunVM());
        return promise;
    }
    pub fn c_aresLookupWithNormalizedName(this: *Resolver, query: GetAddrInfo, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        var channel: *c_ares.Channel = switch (this.getChannel()) {
            .result => |res| res,
            .err => |err| {
                const syscall = bun.String.createAtomASCII(query.name);
                defer syscall.deref();

                const system_error = jsc.SystemError{
                    .errno = -1,
                    .code = bun.String.static(err.code()),
                    .message = bun.String.static(err.label()),
                    .syscall = syscall,
                };

                return globalThis.throwValue(system_error.toErrorInstance(globalThis));
            },
        };

        const key = GetAddrInfoRequest.PendingCacheKey.init(query);

        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_cares);
        if (cache == .inflight) {
            var dns_lookup = bun.handleOom(DNSLookup.init(this, globalThis, globalThis.allocator()));
            cache.inflight.append(dns_lookup);
            return dns_lookup.promise.value();
        }

        const hints_buf = &[_]c_ares.AddrInfo_hints{query.toCAres()};
        var request = GetAddrInfoRequest.init(
            cache,
            .{ .c_ares = {} },
            this,
            query,
            globalThis,
            "pending_host_cache_cares",
        ) catch |err| bun.handleOom(err);
        const promise = request.tail.promise.value();

        channel.getAddrInfo(
            query.name,
            query.port,
            hints_buf,
            GetAddrInfoRequest,
            request,
            GetAddrInfoRequest.onCaresComplete,
        );

        this.requestSent(globalThis.bunVM());
        return promise;
    }

    fn getChannelServers(channel: *c_ares.Channel, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        _ = callframe;
        var servers: ?*c_ares.struct_ares_addr_port_node = null;
        const r = c_ares.ares_get_servers_ports(channel, &servers);
        if (r != c_ares.ARES_SUCCESS) {
            const err = c_ares.Error.get(r).?;
            return globalThis.throwValue(globalThis.createErrorInstance("ares_get_servers_ports error: {s}", .{err.label()}));
        }
        defer c_ares.ares_free_data(servers);

        const values = try jsc.JSValue.createEmptyArray(globalThis, 0);

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
                return globalThis.throwValue(globalThis.createErrorInstance("ares_inet_ntop error: no more space to convert a network format address", .{}));
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
                try values.putIndex(globalThis, i, jsc.ZigString.init(buf[1..size]).withEncoding().toJS(globalThis));
            } else {
                if (family == std.posix.AF.INET6) {
                    buf[0] = '[';
                    buf[size] = ']';
                    const port_slice = std.fmt.bufPrint(buf[size + 1 ..], ":{d}", .{port}) catch unreachable;
                    try values.putIndex(globalThis, i, jsc.ZigString.init(buf[0 .. size + 1 + port_slice.len]).withEncoding().toJS(globalThis));
                } else {
                    const port_slice = std.fmt.bufPrint(buf[size..], ":{d}", .{port}) catch unreachable;
                    try values.putIndex(globalThis, i, jsc.ZigString.init(buf[1 .. size + port_slice.len]).withEncoding().toJS(globalThis));
                }
            }
        }

        return values;
    }

    pub fn getGlobalServers(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return getChannelServers(try getChannelFromVM(globalThis), globalThis, callframe);
    }

    pub fn getServers(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return getChannelServers(try this.getChannelOrError(globalThis), globalThis, callframe);
    }

    pub fn setLocalAddress(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return setChannelLocalAddresses(try this.getChannelOrError(globalThis), globalThis, callframe);
    }

    fn setChannelLocalAddresses(channel: *c_ares.Channel, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments();
        if (arguments.len == 0) {
            return globalThis.throwNotEnoughArguments("setLocalAddress", 1, 0);
        }

        const first_af = try setChannelLocalAddress(channel, globalThis, arguments[0]);

        if (arguments.len < 2 or arguments[1].isUndefined()) {
            return .js_undefined;
        }

        const second_af = try setChannelLocalAddress(channel, globalThis, arguments[1]);

        if (first_af != second_af) {
            return .js_undefined;
        }

        switch (first_af) {
            c_ares.AF.INET => return globalThis.throwInvalidArguments("Cannot specify two IPv4 addresses.", .{}),
            c_ares.AF.INET6 => return globalThis.throwInvalidArguments("Cannot specify two IPv6 addresses.", .{}),
            else => unreachable,
        }
    }

    fn setChannelLocalAddress(channel: *c_ares.Channel, globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError!c_int {
        var str = try value.toSlice(globalThis, bun.default_allocator);
        defer str.deinit();

        const slice = try str.intoOwnedSliceZ(bun.default_allocator);
        defer bun.default_allocator.free(slice);

        var addr: [16]u8 = undefined;

        if (c_ares.ares_inet_pton(c_ares.AF.INET, slice.ptr, &addr) == 1) {
            const ip = std.mem.readInt(u32, addr[0..4], .big);
            c_ares.ares_set_local_ip4(channel, ip);
            return c_ares.AF.INET;
        }

        if (c_ares.ares_inet_pton(c_ares.AF.INET6, slice.ptr, &addr) == 1) {
            c_ares.ares_set_local_ip6(channel, &addr);
            return c_ares.AF.INET6;
        }

        return jsc.Error.INVALID_IP_ADDRESS.throw(globalThis, "Invalid IP address: \"{s}\"", .{slice});
    }

    fn setChannelServers(channel: *c_ares.Channel, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        // It's okay to call dns.setServers with active queries, but not dns.Resolver.setServers
        if (channel != try getChannelFromVM(globalThis) and c_ares.ares_queue_active_queries(channel) != 0) {
            return globalThis.ERR(.DNS_SET_SERVERS_FAILED, "Failed to set servers: there are pending queries", .{}).throw();
        }

        const arguments = callframe.arguments();
        if (arguments.len == 0) {
            return globalThis.throwNotEnoughArguments("setServers", 1, 0);
        }

        const argument = arguments[0];
        if (!argument.isArray()) {
            return globalThis.throwInvalidArgumentType("setServers", "servers", "array");
        }

        var triplesIterator = try argument.arrayIterator(globalThis);

        if (triplesIterator.len == 0) {
            const r = c_ares.ares_set_servers_ports(channel, null);
            if (r != c_ares.ARES_SUCCESS) {
                const err = c_ares.Error.get(r).?;
                return globalThis.throwValue(globalThis.createErrorInstance("ares_set_servers_ports error: {s}", .{err.label()}));
            }
            return .js_undefined;
        }

        const allocator = bun.default_allocator;

        const entries = bun.handleOom(allocator.alloc(c_ares.struct_ares_addr_port_node, triplesIterator.len));
        defer allocator.free(entries);

        var i: u32 = 0;

        while (try triplesIterator.next()) |triple| : (i += 1) {
            if (!triple.isArray()) {
                return globalThis.throwInvalidArgumentType("setServers", "triple", "array");
            }

            const family = (try triple.getIndex(globalThis, 0)).toInt32();
            const port = (try triple.getIndex(globalThis, 2)).toInt32();

            if (family != 4 and family != 6) {
                return globalThis.throwInvalidArguments("Invalid address family", .{});
            }

            const addressString = try (try triple.getIndex(globalThis, 1)).toBunString(globalThis);
            defer addressString.deref();

            const addressSlice = try addressString.toOwnedSlice(allocator);
            defer allocator.free(addressSlice);

            var addressBuffer = bun.handleOom(allocator.alloc(u8, addressSlice.len + 1));
            defer allocator.free(addressBuffer);

            _ = strings.copy(addressBuffer[0..], addressSlice);
            addressBuffer[addressSlice.len] = 0;

            const af: c_int = if (family == 4) std.posix.AF.INET else std.posix.AF.INET6;

            entries[i] = .{
                .next = null,
                .family = af,
                .addr = undefined,
                .udp_port = port,
                .tcp_port = port,
            };

            if (c_ares.ares_inet_pton(af, addressBuffer.ptr, &entries[i].addr) != 1) {
                return jsc.Error.INVALID_IP_ADDRESS.throw(globalThis, "Invalid IP address: \"{s}\"", .{addressSlice});
            }

            if (i > 0) {
                entries[i - 1].next = &entries[i];
            }
        }

        const r = c_ares.ares_set_servers_ports(channel, entries.ptr);
        if (r != c_ares.ARES_SUCCESS) {
            const err = c_ares.Error.get(r).?;
            return globalThis.throwValue(globalThis.createErrorInstance("ares_set_servers_ports error: {s}", .{err.label()}));
        }

        return .js_undefined;
    }

    pub fn setGlobalServers(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return setChannelServers(try getChannelFromVM(globalThis), globalThis, callframe);
    }

    pub fn setServers(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return setChannelServers(try this.getChannelOrError(globalThis), globalThis, callframe);
    }

    pub fn newResolver(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const resolver = Resolver.init(globalThis.allocator(), globalThis.bunVM());

        const options = callframe.argument(0);
        if (options.isObject()) {
            if (try options.getTruthy(globalThis, "timeout")) |timeout| {
                resolver.options.timeout = try timeout.coerceToInt32(globalThis);
            }

            if (try options.getTruthy(globalThis, "tries")) |tries| {
                resolver.options.tries = try tries.coerceToInt32(globalThis);
            }
        }

        return resolver.toJS(globalThis);
    }

    pub fn cancel(this: *Resolver, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        _ = callframe;
        const channel = try this.getChannelOrError(globalThis);
        c_ares.ares_cancel(channel);
        return .js_undefined;
    }

    // Resolves the given address and port into a host name and service using the operating system's underlying getnameinfo implementation.
    // If address is not a valid IP address, a TypeError will be thrown. The port will be coerced to a number.
    // If it is not a legal port, a TypeError will be thrown.
    pub fn globalLookupService(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(2);
        if (arguments.len < 2) {
            return globalThis.throwNotEnoughArguments("lookupService", 2, arguments.len);
        }

        const addr_value = arguments.ptr[0];
        if (addr_value.isEmptyOrUndefinedOrNull() or !addr_value.isString()) {
            return globalThis.throwInvalidArgumentType("lookupService", "address", "string");
        }

        const addr_str = try addr_value.toJSString(globalThis);
        if (addr_str.length() == 0) {
            return globalThis.throwInvalidArgumentType("lookupService", "address", "non-empty string");
        }
        const addr_s = addr_str.getZigString(globalThis).slice();

        const port_value = arguments.ptr[1];
        const port: u16 = try port_value.toPortNumber(globalThis);

        var sa: std.posix.sockaddr.storage = std.mem.zeroes(std.posix.sockaddr.storage);
        if (c_ares.getSockaddr(addr_s, port, @as(*std.posix.sockaddr, @ptrCast(&sa))) != 0) {
            return globalThis.throwInvalidArgumentValue("address", addr_value);
        }

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);
        var channel = try resolver.getChannelOrError(globalThis);

        // This string will be freed in `CAresNameInfo.deinit`
        const cache_name = bun.handleOom(std.fmt.allocPrint(bun.default_allocator, "{s}|{d}", .{ addr_s, port }));

        const key = GetNameInfoRequest.PendingCacheKey.init(cache_name);
        var cache = resolver.getOrPutIntoResolvePendingCache(
            GetNameInfoRequest,
            key,
            "pending_nameinfo_cache_cares",
        );

        if (cache == .inflight) {
            var info = bun.handleOom(CAresNameInfo.init(globalThis, globalThis.allocator(), cache_name));
            cache.inflight.append(info);
            return info.promise.value();
        }

        var request = GetNameInfoRequest.init(
            cache,
            resolver,
            cache_name, // transfer ownership here
            globalThis,
            "pending_nameinfo_cache_cares",
        ) catch |err| bun.handleOom(err);

        const promise = request.tail.promise.value();
        channel.getNameInfo(
            @as(*std.posix.sockaddr, @ptrCast(&sa)),
            GetNameInfoRequest,
            request,
            GetNameInfoRequest.onCaresComplete,
        );

        resolver.requestSent(globalThis.bunVM());
        return promise;
    }

    pub fn getRuntimeDefaultResultOrderOption(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return globalThis.bunVM().dns_result_order.toJS(globalThis);
    }

    comptime {
        const js_resolve = jsc.toJSHostFn(globalResolve);
        @export(&js_resolve, .{ .name = "Bun__DNS__resolve" });
        const js_lookup = jsc.toJSHostFn(globalLookup);
        @export(&js_lookup, .{ .name = "Bun__DNS__lookup" });
        const js_resolveTxt = jsc.toJSHostFn(globalResolveTxt);
        @export(&js_resolveTxt, .{ .name = "Bun__DNS__resolveTxt" });
        const js_resolveSoa = jsc.toJSHostFn(globalResolveSoa);
        @export(&js_resolveSoa, .{ .name = "Bun__DNS__resolveSoa" });
        const js_resolveMx = jsc.toJSHostFn(globalResolveMx);
        @export(&js_resolveMx, .{ .name = "Bun__DNS__resolveMx" });
        const js_resolveNaptr = jsc.toJSHostFn(globalResolveNaptr);
        @export(&js_resolveNaptr, .{ .name = "Bun__DNS__resolveNaptr" });
        const js_resolveSrv = jsc.toJSHostFn(globalResolveSrv);
        @export(&js_resolveSrv, .{ .name = "Bun__DNS__resolveSrv" });
        const js_resolveCaa = jsc.toJSHostFn(globalResolveCaa);
        @export(&js_resolveCaa, .{ .name = "Bun__DNS__resolveCaa" });
        const js_resolveNs = jsc.toJSHostFn(globalResolveNs);
        @export(&js_resolveNs, .{ .name = "Bun__DNS__resolveNs" });
        const js_resolvePtr = jsc.toJSHostFn(globalResolvePtr);
        @export(&js_resolvePtr, .{ .name = "Bun__DNS__resolvePtr" });
        const js_resolveCname = jsc.toJSHostFn(globalResolveCname);
        @export(&js_resolveCname, .{ .name = "Bun__DNS__resolveCname" });
        const js_resolveAny = jsc.toJSHostFn(globalResolveAny);
        @export(&js_resolveAny, .{ .name = "Bun__DNS__resolveAny" });
        const js_getGlobalServers = jsc.toJSHostFn(getGlobalServers);
        @export(&js_getGlobalServers, .{ .name = "Bun__DNS__getServers" });
        const js_setGlobalServers = jsc.toJSHostFn(setGlobalServers);
        @export(&js_setGlobalServers, .{ .name = "Bun__DNS__setServers" });
        const js_reverse = jsc.toJSHostFn(globalReverse);
        @export(&js_reverse, .{ .name = "Bun__DNS__reverse" });
        const js_lookupService = jsc.toJSHostFn(globalLookupService);
        @export(&js_lookupService, .{ .name = "Bun__DNS__lookupService" });
        const js_prefetchFromJS = jsc.toJSHostFn(internal.prefetchFromJS);
        @export(&js_prefetchFromJS, .{ .name = "Bun__DNS__prefetch" });
        const js_getDNSCacheStats = jsc.toJSHostFn(internal.getDNSCacheStats);
        @export(&js_getDNSCacheStats, .{ .name = "Bun__DNS__getCacheStats" });
    }
};

const string = []const u8;

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const c_ares = bun.c_ares;
const default_allocator = bun.default_allocator;
const strings = bun.strings;
const timespec = bun.timespec;
const GetAddrInfo = bun.dns.GetAddrInfo;
const libuv = bun.windows.libuv;
const EventLoopTimer = bun.api.Timer.EventLoopTimer;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
