const Bun = @This();
const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const NetworkThread = @import("root").bun.HTTP.NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = @import("root").bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const c_ares = bun.c_ares;

const GetAddrInfoAsyncCallback = fn (i32, ?*std.c.addrinfo, ?*anyopaque) callconv(.C) void;

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

        handle = std.c.dlopen("libinfo.dylib", RTLD_LAZY | RTLD_LOCAL);
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

        var key = GetAddrInfoRequest.PendingCacheKey.init(query);
        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_native);

        if (cache == .inflight) {
            var dns_lookup = DNSLookup.init(globalThis, globalThis.allocator()) catch unreachable;

            cache.inflight.append(dns_lookup);

            return dns_lookup.promise.value();
        }

        var name_buf: [1024]u8 = undefined;
        _ = strings.copy(name_buf[0..], query.name);

        name_buf[query.name.len] = 0;
        var name_z = name_buf[0..query.name.len :0];

        var request = GetAddrInfoRequest.init(
            cache,
            .{ .libinfo = undefined },
            this,
            query,
            globalThis,
            "pending_host_cache_native",
        ) catch unreachable;
        const promise_value = request.head.promise.value();

        const errno = getaddrinfo_async_start_(
            &request.backend.libinfo.machport,
            name_z.ptr,
            null,
            null,
            GetAddrInfoRequest.getAddrInfoAsyncCallback,
            request,
        );

        if (errno != 0) {
            request.head.promise.reject(globalThis, globalThis.createErrorInstance("getaddrinfo_async_start error: {s}", .{@tagName(std.c.getErrno(errno))}));
            if (request.cache.pending_cache) this.pending_host_cache_native.available.set(request.cache.pos_in_pending);
            this.vm.allocator.destroy(request);

            return promise_value;
        }
        std.debug.assert(request.backend.libinfo.machport != null);
        request.backend.libinfo.file_poll = bun.JSC.FilePoll.init(this.vm, std.math.maxInt(i32) - 1, .{}, GetAddrInfoRequest, request);
        std.debug.assert(
            request.backend.libinfo.file_poll.?.registerWithFd(
                this.vm.uws_event_loop.?,
                .machport,
                true,
                @ptrToInt(request.backend.libinfo.machport),
            ) == .result,
        );

        return promise_value;
    }
};

const LibC = struct {
    pub fn lookup(this: *DNSResolver, query_init: GetAddrInfo, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const key = GetAddrInfoRequest.PendingCacheKey.init(query_init);

        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_native);
        if (cache == .inflight) {
            var dns_lookup = DNSLookup.init(globalThis, globalThis.allocator()) catch unreachable;

            cache.inflight.append(dns_lookup);

            return dns_lookup.promise.value();
        }

        var query = query_init.clone();

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

pub fn addressToString(
    allocator: std.mem.Allocator,
    address: std.net.Address,
) JSC.ZigString {
    const str: []const u8 = brk: {
        switch (address.any.family) {
            std.os.AF.INET => {
                var self = address.in;
                const bytes = @ptrCast(*const [4]u8, &self.sa.addr);
                break :brk std.fmt.allocPrint(allocator, "{}.{}.{}.{}", .{
                    bytes[0],
                    bytes[1],
                    bytes[2],
                    bytes[3],
                }) catch unreachable;
            },
            std.os.AF.INET6 => {
                var out = std.fmt.allocPrint(allocator, "{any}", .{address}) catch unreachable;
                // TODO: this is a hack, fix it
                // This removes [.*]:port
                //              ^  ^^^^^^
                break :brk out[1 .. out.len - 1 - std.fmt.count("{d}", .{address.in6.getPort()}) - 1];
            },
            std.os.AF.UNIX => {
                break :brk std.mem.sliceTo(&address.un.path, 0);
            },
            else => break :brk "",
        }
    };

    return JSC.ZigString.init(str);
}

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
    }

    return name;
}

pub fn addressToJS(
    allocator: std.mem.Allocator,
    address: std.net.Address,
    globalThis: *JSC.JSGlobalObject,
) JSC.JSValue {
    return addressToString(allocator, address).toValueGC(globalThis);
}

fn addrInfoCount(addrinfo: *std.c.addrinfo) u32 {
    var count: u32 = 1;
    var current: ?*std.c.addrinfo = addrinfo.next;
    while (current != null) : (current = current.?.next) {
        count += @boolToInt(current.?.addr != null);
    }
    return count;
}

pub fn addrInfoToJSArray(
    parent_allocator: std.mem.Allocator,
    addr_info: *std.c.addrinfo,
    globalThis: *JSC.JSGlobalObject,
) JSC.JSValue {
    var stack = std.heap.stackFallback(2048, parent_allocator);
    var arena = @import("root").bun.ArenaAllocator.init(stack.get());
    const array = JSC.JSValue.createEmptyArray(
        globalThis,
        addrInfoCount(addr_info),
    );

    {
        defer arena.deinit();

        var allocator = arena.allocator();
        var j: u32 = 0;
        var current: ?*std.c.addrinfo = addr_info;
        while (current) |this_node| : (current = current.?.next) {
            array.putIndex(
                globalThis,
                j,
                bun.JSC.DNS.GetAddrInfo.Result.toJS(
                    &(bun.JSC.DNS.GetAddrInfo.Result.fromAddrInfo(this_node) orelse continue),
                    globalThis,
                    allocator,
                ),
            );
            j += 1;
        }
    }

    return array;
}

pub const GetAddrInfo = struct {
    name: []const u8 = "",
    port: u16 = 0,
    options: Options = Options{},

    pub fn clone(this: GetAddrInfo) GetAddrInfo {
        return GetAddrInfo{
            .name = bun.default_allocator.dupe(u8, this.name) catch unreachable,
            .port = this.port,
            .options = this.options,
        };
    }

    pub fn toCAres(this: GetAddrInfo) bun.c_ares.AddrInfo_hints {
        var hints: bun.c_ares.AddrInfo_hints = undefined;
        bun.oldMemset(std.mem.asBytes(&hints), 0, @sizeOf(bun.c_ares.AddrInfo_hints));

        hints.ai_family = this.options.family.toLibC();
        hints.ai_socktype = this.options.socktype.toLibC();
        hints.ai_protocol = this.options.protocol.toLibC();
        hints.ai_flags = this.options.flags;

        return hints;
    }

    pub fn hash(self: GetAddrInfo) u64 {
        var hasher = std.hash.Wyhash.init(0);
        const bytes =
            std.mem.asBytes(&self.port) ++
            std.mem.asBytes(&self.options);

        hasher.update(bytes);
        hasher.update(self.name);

        return hasher.final();
    }

    pub const Options = packed struct {
        family: Family = .unspecified,
        socktype: SocketType = .unspecified,
        protocol: Protocol = .unspecified,
        backend: Backend = Backend.default,
        flags: i32 = 0,

        pub fn toLibC(this: Options) ?std.c.addrinfo {
            if (this.family == .unspecified and this.socktype == .unspecified and this.protocol == .unspecified and this.flags == 0) {
                return null;
            }

            var hints: std.c.addrinfo = undefined;
            bun.oldMemset(std.mem.asBytes(&hints), 0, @sizeOf(std.c.addrinfo));

            hints.family = this.family.toLibC();
            hints.socktype = this.socktype.toLibC();
            hints.protocol = this.protocol.toLibC();
            hints.flags = this.flags;
            return hints;
        }

        pub fn fromJS(value: JSC.JSValue, globalObject: *JSC.JSGlobalObject) !Options {
            if (value.isEmptyOrUndefinedOrNull())
                return Options{};

            if (value.isObject()) {
                var options = Options{};

                if (value.get(globalObject, "family")) |family| {
                    options.family = try Family.fromJS(family, globalObject);
                }

                if (value.get(globalObject, "socketType") orelse value.get(globalObject, "socktype")) |socktype| {
                    options.socktype = try SocketType.fromJS(socktype, globalObject);
                }

                if (value.get(globalObject, "protocol")) |protocol| {
                    options.protocol = try Protocol.fromJS(protocol, globalObject);
                }

                if (value.get(globalObject, "backend")) |backend| {
                    options.backend = try Backend.fromJS(backend, globalObject);
                }

                if (value.get(globalObject, "flags")) |flags| {
                    if (!flags.isNumber())
                        return error.InvalidFlags;

                    options.flags = flags.coerce(i32, globalObject);
                }

                return options;
            }

            return error.InvalidOptions;
        }
    };

    pub const Family = enum(u2) {
        unspecified,
        inet,
        inet6,
        unix,

        pub const map = bun.ComptimeStringMap(Family, .{
            .{ "IPv4", Family.inet },
            .{ "IPv6", Family.inet6 },
            .{ "ipv4", Family.inet },
            .{ "ipv6", Family.inet6 },
            .{ "any", Family.unspecified },
        });

        pub fn fromJS(value: JSC.JSValue, globalObject: *JSC.JSGlobalObject) !Family {
            if (value.isEmptyOrUndefinedOrNull())
                return .unspecified;

            if (value.isNumber()) {
                return switch (value.coerce(i32, globalObject)) {
                    0 => .unspecified,
                    4 => .inet,
                    6 => .inet6,
                    else => return error.InvalidFamily,
                };
            }

            if (value.isString()) {
                const str = value.toBunString(globalObject);
                if (str.isEmpty())
                    return .unspecified;

                return str.inMap(map) orelse return error.InvalidFamily;
            }

            return error.InvalidFamily;
        }

        pub fn toLibC(this: Family) i32 {
            return switch (this) {
                .unspecified => 0,
                .inet => std.os.AF.INET,
                .inet6 => std.os.AF.INET6,
                .unix => std.os.AF.UNIX,
            };
        }
    };

    pub const SocketType = enum(u2) {
        unspecified,
        stream,
        dgram,

        const map = bun.ComptimeStringMap(SocketType, .{
            .{ "stream", SocketType.stream },
            .{ "dgram", SocketType.dgram },
            .{ "tcp", SocketType.stream },
            .{ "udp", SocketType.dgram },
        });

        pub fn toLibC(this: SocketType) i32 {
            switch (this) {
                .unspecified => return 0,
                .stream => return std.os.SOCK.STREAM,
                .dgram => return std.os.SOCK.DGRAM,
            }
        }

        pub fn fromJS(value: JSC.JSValue, globalObject: *JSC.JSGlobalObject) !SocketType {
            if (value.isEmptyOrUndefinedOrNull())
                return .unspecified;

            if (value.isNumber()) {
                return switch (value.to(i32)) {
                    0 => .unspecified,
                    1 => .stream,
                    2 => .dgram,
                    else => return error.InvalidSocketType,
                };
            }

            if (value.isString()) {
                const str = value.getZigString(globalObject);
                if (str.len == 0)
                    return .unspecified;

                return map.getWithEql(str, JSC.ZigString.eqlComptime) orelse return error.InvalidSocketType;
            }

            return error.InvalidSocketType;
        }
    };

    pub const Protocol = enum(u2) {
        unspecified,
        tcp,
        udp,

        const map = bun.ComptimeStringMap(Protocol, .{
            .{ "tcp", Protocol.tcp },
            .{ "udp", Protocol.udp },
        });

        pub fn fromJS(value: JSC.JSValue, globalObject: *JSC.JSGlobalObject) !Protocol {
            if (value.isEmptyOrUndefinedOrNull())
                return .unspecified;

            if (value.isNumber()) {
                return switch (value.to(i32)) {
                    0 => .unspecified,
                    6 => .tcp,
                    17 => .udp,
                    else => return error.InvalidProtocol,
                };
            }

            if (value.isString()) {
                const str = value.getZigString(globalObject);
                if (str.len == 0)
                    return .unspecified;

                return map.getWithEql(str, JSC.ZigString.eqlComptime) orelse return error.InvalidProtocol;
            }

            return error.InvalidProtocol;
        }

        pub fn toLibC(this: Protocol) i32 {
            switch (this) {
                .unspecified => return 0,
                .tcp => return std.os.IPPROTO.TCP,
                .udp => return std.os.IPPROTO.UDP,
            }
        }
    };

    pub const Backend = enum(u2) {
        c_ares,
        system,
        libc,

        pub const label = bun.ComptimeStringMap(GetAddrInfo.Backend, .{
            .{ "c-ares", .c_ares },
            .{ "c_ares", .c_ares },
            .{ "cares", .c_ares },
            .{ "async", .c_ares },
            .{ "libc", .libc },
            .{ "system", .system },
            .{ "getaddrinfo", .libc },
        });

        pub const default: GetAddrInfo.Backend = if (Environment.isMac)
            GetAddrInfo.Backend.system
        else
            GetAddrInfo.Backend.c_ares;

        pub fn fromJS(value: JSC.JSValue, globalObject: *JSC.JSGlobalObject) !Backend {
            if (value.isEmptyOrUndefinedOrNull())
                return default;

            if (value.isString()) {
                const str = value.getZigString(globalObject);
                if (str.len == 0)
                    return default;

                return label.getWithEql(str, JSC.ZigString.eqlComptime) orelse return error.InvalidBackend;
            }

            return error.InvalidBackend;
        }
    };

    pub const Result = struct {
        address: std.net.Address,
        ttl: i32 = 0,

        pub const List = std.ArrayList(Result);

        pub const Any = union(enum) {
            addrinfo: ?*std.c.addrinfo,
            list: List,

            pub fn toJS(this: Any, globalThis: *JSC.JSGlobalObject) ?JSC.JSValue {
                return switch (this) {
                    .addrinfo => |addrinfo| addrInfoToJSArray(globalThis.allocator(), addrinfo orelse return null, globalThis),
                    .list => |list| brk: {
                        var stack = std.heap.stackFallback(2048, globalThis.allocator());
                        var arena = @import("root").bun.ArenaAllocator.init(stack.get());
                        const array = JSC.JSValue.createEmptyArray(globalThis, @truncate(u32, list.items.len));
                        var i: u32 = 0;
                        const items: []const Result = list.items;
                        for (items) |item| {
                            array.putIndex(globalThis, i, item.toJS(globalThis, arena.allocator()));
                            i += 1;
                        }
                        break :brk array;
                    },
                };
            }

            pub fn deinit(this: Any) void {
                switch (this) {
                    .addrinfo => |addrinfo| {
                        if (addrinfo) |a| {
                            std.c.freeaddrinfo(a);
                        }
                    },
                    .list => |list| {
                        var list_ = list;
                        list_.deinit();
                    },
                }
            }
        };

        pub fn toList(allocator: std.mem.Allocator, addrinfo: *std.c.addrinfo) !List {
            var list = try List.initCapacity(allocator, addrInfoCount(addrinfo));

            var addr: ?*std.c.addrinfo = addrinfo;
            while (addr) |a| : (addr = a.next) {
                list.appendAssumeCapacity(fromAddrInfo(a) orelse continue);
            }

            return list;
        }

        pub fn fromAddrInfo(addrinfo: *std.c.addrinfo) ?Result {
            return Result{
                .address = std.net.Address.initPosix(@alignCast(4, addrinfo.addr orelse return null)),
                // no TTL in POSIX getaddrinfo()
                .ttl = 0,
            };
        }

        pub fn toJS(this: *const Result, globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator) JSValue {
            const obj = JSC.JSValue.createEmptyObject(globalThis, 3);
            obj.put(globalThis, JSC.ZigString.static("address"), addressToJS(allocator, this.address, globalThis));
            obj.put(globalThis, JSC.ZigString.static("family"), switch (this.address.any.family) {
                std.os.AF.INET => JSValue.jsNumber(4),
                std.os.AF.INET6 => JSValue.jsNumber(6),
                else => JSValue.jsNumber(0),
            });
            obj.put(globalThis, JSC.ZigString.static("ttl"), JSValue.jsNumber(this.ttl));
            return obj;
        }
    };
};

pub fn ResolveInfoRequest(comptime cares_type: type, comptime type_name: []const u8) type {
    return struct {
        const request_type = @This();

        const log = Output.scoped(@This(), false);

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
            var poll_ref = JSC.PollRef.init();
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
                    .pos_in_pending = @truncate(u5, @field(resolver.?, cache_field).indexOf(cache.new).?),
                    .name_len = @truncate(u9, name.len),
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
                    .len = @truncate(u16, name.len),
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
        var request = try globalThis.allocator().create(GetAddrInfoRequest);
        var poll_ref = JSC.PollRef.init();
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
                .pos_in_pending = @truncate(u5, @field(resolver.?, cache_field).indexOf(cache.new).?),
                .name_len = @truncate(u9, query.name.len),
            };
            cache.new.lookup = request;
        }
        return request;
    }

    pub const Task = bun.JSC.WorkTask(GetAddrInfoRequest, false);

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
                .len = @truncate(u16, query.name.len),
                .lookup = undefined,
            };
        }
    };

    pub fn getAddrInfoAsyncCallback(
        status: i32,
        addr_info: ?*std.c.addrinfo,
        arg: ?*anyopaque,
    ) callconv(.C) void {
        const this = @intToPtr(*GetAddrInfoRequest, @ptrToInt(arg));
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
        libc: union(enum) {
            success: GetAddrInfo.Result.List,
            err: i32,
            query: GetAddrInfo,

            pub fn run(this: *@This()) void {
                const query = this.query;
                defer bun.default_allocator.free(bun.constStrToU8(query.name));
                var hints = query.options.toLibC();
                var port_buf: [128]u8 = undefined;
                var port = std.fmt.bufPrintIntToSlice(&port_buf, query.port, 10, .lower, .{});
                port_buf[port.len] = 0;
                var portZ = port_buf[0..port.len :0];
                var hostname: [bun.MAX_PATH_BYTES]u8 = undefined;
                _ = strings.copy(hostname[0..], query.name);
                hostname[query.name.len] = 0;
                var addrinfo: ?*std.c.addrinfo = null;
                var host = hostname[0..query.name.len :0];
                const debug_timer = bun.Output.DebugTimer.start();
                const err = std.c.getaddrinfo(
                    host.ptr,
                    if (port.len > 0) portZ.ptr else null,
                    if (hints) |*hint| hint else null,
                    &addrinfo,
                );
                JSC.Node.Syscall.syslog("getaddrinfo({s}, {d}) = {d} ({any})", .{
                    query.name,
                    port,
                    err,
                    debug_timer,
                });
                if (@enumToInt(err) != 0 or addrinfo == null) {
                    this.* = .{ .err = @enumToInt(err) };
                    return;
                }

                // do not free addrinfo when err != 0
                // https://github.com/ziglang/zig/pull/14242
                defer std.c.freeaddrinfo(addrinfo.?);

                this.* = .{ .success = GetAddrInfo.Result.toList(default_allocator, addrinfo.?) catch unreachable };
            }
        },

        pub const LibInfo = struct {
            file_poll: ?*bun.JSC.FilePoll = null,
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
};

pub fn CAresLookup(comptime cares_type: type, comptime type_name: []const u8) type {
    return struct {
        const log = Output.scoped(@This(), true);

        globalThis: *JSC.JSGlobalObject = undefined,
        promise: JSC.JSPromise.Strong,
        poll_ref: JSC.PollRef,
        allocated: bool = false,
        next: ?*@This() = null,
        name: []const u8,

        pub fn init(globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator, name: []const u8) !*@This() {
            var this = try allocator.create(@This());
            var poll_ref = JSC.PollRef.init();
            poll_ref.ref(globalThis.bunVM());
            this.* = .{ .globalThis = globalThis, .promise = JSC.JSPromise.Strong.init(globalThis), .poll_ref = poll_ref, .allocated = true, .name = name };
            return this;
        }

        pub fn processResolve(this: *@This(), err_: ?c_ares.Error, _: i32, result: ?*cares_type) void {
            if (err_) |err| {
                var promise = this.promise;
                var globalThis = this.globalThis;
                const error_value = globalThis.createErrorInstance("{s} lookup failed: {s}", .{ type_name, err.label() });
                error_value.put(
                    globalThis,
                    JSC.ZigString.static("code"),
                    JSC.ZigString.init(err.code()).toValueGC(globalThis),
                );

                promise.reject(globalThis, error_value);
                this.deinit();
                return;
            }
            if (result == null) {
                var promise = this.promise;
                var globalThis = this.globalThis;
                const error_value = globalThis.createErrorInstance("{s} lookup failed: {s}", .{ type_name, "No results" });
                error_value.put(
                    globalThis,
                    JSC.ZigString.static("code"),
                    JSC.ZigString.init("EUNREACHABLE").toValueGC(globalThis),
                );

                promise.reject(globalThis, error_value);
                this.deinit();
                return;
            }
            var node = result.?;
            const array = node.toJSReponse(this.globalThis.allocator(), this.globalThis, type_name);
            this.onComplete(array);
            return;
        }

        pub fn onComplete(this: *@This(), result: JSC.JSValue) void {
            var promise = this.promise;
            var globalThis = this.globalThis;
            this.promise = .{};
            promise.resolve(globalThis, result);
            this.deinit();
        }

        pub fn deinit(this: *@This()) void {
            this.poll_ref.unrefOnNextTick(this.globalThis.bunVM());
            bun.default_allocator.free(this.name);

            if (this.allocated)
                this.globalThis.allocator().destroy(this);
        }
    };
}

pub const DNSLookup = struct {
    const log = Output.scoped(.DNSLookup, true);

    globalThis: *JSC.JSGlobalObject = undefined,
    promise: JSC.JSPromise.Strong,
    allocated: bool = false,
    next: ?*DNSLookup = null,
    poll_ref: JSC.PollRef,

    pub fn init(globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator) !*DNSLookup {
        var this = try allocator.create(DNSLookup);
        var poll_ref = JSC.PollRef.init();
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
        const array = result.toJS(this.globalThis).?;
        this.onCompleteWithArray(array);
    }

    pub fn processGetAddrInfoNative(this: *DNSLookup, status: i32, result: ?*std.c.addrinfo) void {
        if (c_ares.Error.initEAI(status)) |err| {
            var promise = this.promise;
            var globalThis = this.globalThis;

            const error_value = brk: {
                if (err == .ESERVFAIL) {
                    break :brk JSC.Node.Syscall.Error.fromCode(std.c.getErrno(-1), .getaddrinfo).toJSC(globalThis);
                }
                const error_value = globalThis.createErrorInstance("DNS lookup failed: {s}", .{err.label()});
                error_value.put(
                    globalThis,
                    JSC.ZigString.static("code"),
                    JSC.ZigString.init(err.code()).toValueGC(globalThis),
                );
                break :brk error_value;
            };

            this.deinit();

            promise.reject(globalThis, error_value);
            return;
        }

        onCompleteNative(this, .{ .addrinfo = result });
    }

    pub fn processGetAddrInfo(this: *DNSLookup, err_: ?c_ares.Error, _: i32, result: ?*c_ares.AddrInfo) void {
        if (err_) |err| {
            var promise = this.promise;
            var globalThis = this.globalThis;
            const error_value = globalThis.createErrorInstance("DNS lookup failed: {s}", .{err.label()});
            error_value.put(
                globalThis,
                JSC.ZigString.static("code"),
                JSC.ZigString.init(err.code()).toValueGC(globalThis),
            );

            promise.reject(globalThis, error_value);
            this.deinit();
            return;
        }

        if (result == null or result.?.node == null) {
            var promise = this.promise;
            var globalThis = this.globalThis;
            const error_value = globalThis.createErrorInstance("DNS lookup failed: {s}", .{"No results"});
            error_value.put(
                globalThis,
                JSC.ZigString.static("code"),
                JSC.ZigString.init("EUNREACHABLE").toValueGC(globalThis),
            );

            promise.reject(globalThis, error_value);
            this.deinit();
            return;
        }

        this.onComplete(result.?);
    }

    pub fn onComplete(this: *DNSLookup, result: *c_ares.AddrInfo) void {
        const array = result.toJSArray(this.globalThis.allocator(), this.globalThis);
        this.onCompleteWithArray(array);
    }

    pub fn onCompleteWithArray(this: *DNSLookup, result: JSC.JSValue) void {
        var promise = this.promise;
        var globalThis = this.globalThis;
        this.promise = .{};

        promise.resolve(globalThis, result);
        this.deinit();
    }

    pub fn deinit(this: *DNSLookup) void {
        this.poll_ref.unrefOnNextTick(this.globalThis.bunVM());
        if (this.allocated)
            this.globalThis.allocator().destroy(this);
    }
};

pub const GlobalData = struct {
    resolver: DNSResolver,

    pub fn init(allocator: std.mem.Allocator, vm: *JSC.VirtualMachine) *GlobalData {
        var global = allocator.create(GlobalData) catch unreachable;
        global.* = .{
            .resolver = .{
                .vm = vm,
                .polls = std.AutoArrayHashMap(i32, ?*JSC.FilePoll).init(allocator),
            },
        };

        return global;
    }
};

pub const DNSResolver = struct {
    const log = Output.scoped(.DNSResolver, true);

    channel: ?*c_ares.Channel = null,
    vm: *JSC.VirtualMachine,
    polls: std.AutoArrayHashMap(i32, ?*JSC.FilePoll) = undefined,

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

    fn getKey(this: *DNSResolver, index: u8, comptime cache_name: []const u8, comptime request_type: type) request_type.PendingCacheKey {
        var cache = &@field(this, cache_name);
        std.debug.assert(!cache.available.isSet(index));
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
        var array = addr.toJSReponse(this.vm.allocator, prev_global, lookup_name);
        defer addr.deinit();
        array.ensureStillAlive();
        key.lookup.head.onComplete(array);
        bun.default_allocator.destroy(key.lookup);

        array.ensureStillAlive();

        while (pending) |value| {
            var new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addr.toJSReponse(this.vm.allocator, new_global, lookup_name);
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
        var array = addr.toJSArray(this.vm.allocator, prev_global);
        defer addr.deinit();
        array.ensureStillAlive();
        key.lookup.head.onCompleteWithArray(array);
        bun.default_allocator.destroy(key.lookup);

        array.ensureStillAlive();
        // std.c.addrinfo

        while (pending) |value| {
            var new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addr.toJSArray(this.vm.allocator, new_global);
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
            var new_global = value.globalThis;
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
            var entry: *request_type.PendingCacheKey = &cache.buffer[index];
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
            var entry: *GetAddrInfoRequest.PendingCacheKey = &cache.buffer[index];
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

    pub fn onDNSPoll(
        this: *DNSResolver,
        poll: *JSC.FilePoll,
    ) void {
        var channel = this.channel orelse {
            _ = this.polls.orderedRemove(@intCast(i32, poll.fd));
            poll.deinit();
            return;
        };

        channel.process(
            @intCast(i32, poll.fd),
            poll.isReadable(),
            poll.isWritable(),
        );
    }

    pub fn onDNSSocketState(
        this: *DNSResolver,
        fd: i32,
        readable: bool,
        writable: bool,
    ) void {
        var vm = this.vm;

        if (!readable and !writable) {
            // read == 0 and write == 0 this is c-ares's way of notifying us that
            // the socket is now closed. We must free the data associated with
            // socket.
            if (this.polls.fetchOrderedRemove(fd)) |entry| {
                if (entry.value) |val| {
                    val.deinitWithVM(vm);
                }
            }

            return;
        }

        var poll_entry = this.polls.getOrPut(fd) catch unreachable;

        if (!poll_entry.found_existing) {
            poll_entry.value_ptr.* = JSC.FilePoll.init(vm, fd, .{}, DNSResolver, this);
        }

        var poll = poll_entry.value_ptr.*.?;

        if (readable and !poll.flags.contains(.poll_readable))
            _ = poll.register(vm.uws_event_loop.?, .readable, false);

        if (writable and !poll.flags.contains(.poll_writable))
            _ = poll.register(vm.uws_event_loop.?, .writable, false);
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

    pub fn resolve(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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
    // pub fn reverse(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    //     const arguments = callframe.arguments(3);

    // }

    pub fn lookup(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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
            .libc => LibC.lookup(this, query, globalThis),
            .system => if (comptime Environment.isMac)
                LibInfo.lookup(this, query, globalThis)
            else
                LibC.lookup(this, query, globalThis),
        };
    }

    pub fn resolveSrv(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

    pub fn resolveSoa(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("resolveSoa", "hostname", "non-empty string");
            return .zero;
        }

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_ares_soa_reply, "soa", name.slice(), globalThis);
    }

    pub fn resolveCaa(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

    pub fn resolveNs(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

        if (name_str.length() == 0) {
            globalThis.throwInvalidArgumentType("resolveNs", "hostname", "non-empty string");
            return .zero;
        }

        const name = name_str.toSliceClone(globalThis, bun.default_allocator);

        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doResolveCAres(c_ares.struct_hostent, "ns", name.slice(), globalThis);
    }

    pub fn resolvePtr(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

    pub fn resolveCname(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

    pub fn resolveMx(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

    pub fn resolveNaptr(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

    pub fn resolveTxt(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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
                const system_error = JSC.SystemError{
                    .errno = -1,
                    .code = JSC.ZigString.init(err.code()),
                    .message = JSC.ZigString.init(err.label()),
                };

                globalThis.throwValue(system_error.toErrorInstance(globalThis));
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
                    .code = JSC.ZigString.init(err.code()),
                    .message = JSC.ZigString.init(err.label()),
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

        // var hints_buf = &[_]c_ares.AddrInfo_hints{query.toCAres()};
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
            &.{},
            GetAddrInfoRequest,
            request,
            GetAddrInfoRequest.onCaresComplete,
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
    }
    // pub fn lookupService(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    //     const arguments = callframe.arguments(3);

    // }
    // pub fn cancel(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    //     const arguments = callframe.arguments(3);

    // }
};
