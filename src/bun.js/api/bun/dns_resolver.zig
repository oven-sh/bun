const Bun = @This();
const default_allocator = @import("bun").default_allocator;
const bun = @import("bun");
const Environment = bun.Environment;
const NetworkThread = @import("bun").HTTP.NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("bun").Output;
const MutableString = @import("bun").MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = @import("bun").JSC;
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
            return bun.C.dlsymWithHandle(*const GetaddrinfoAsyncStart, "getaddrinfo_async_start", getHandle);
        }
    }.get;

    pub const getaddrinfo_async_handle_reply = struct {
        pub fn get() ?*const GetaddrinfoAsyncHandleReply {
            return bun.C.dlsymWithHandle(*const GetaddrinfoAsyncHandleReply, "getaddrinfo_async_handle_reply", getHandle);
        }
    }.get;

    pub fn get() ?*const GetaddrinfoAsyncCancel {
        return bun.C.dlsymWithHandle(*const GetaddrinfoAsyncCancel, "getaddrinfo_async_cancel", getHandle);
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

pub fn normalizeDNSName(name: []const u8) []const u8 {

    // https://github.com/c-ares/c-ares/issues/477
    if (strings.endsWithComptime(name, ".localhost")) {
        return "localhost";
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
    var arena = std.heap.ArenaAllocator.init(stack.get());
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
            const addr = std.net.Address.initPosix(@alignCast(4, this_node.addr orelse continue));

            array.putIndex(
                globalThis,
                j,
                bun.JSC.DNS.DNSLookup.Result.toJS(
                    &.{
                        .address = addr,
                        .ttl = 0,
                    },
                    globalThis,
                    allocator,
                ),
            );
            j += 1;
        }
    }

    return array;
}

pub const DNSLookup = struct {
    const log = Output.scoped(.DNSLookup, true);

    globalThis: *JSC.JSGlobalObject = undefined,
    poll_ref: bun.JSC.PollRef = .{},
    promise: JSC.JSPromise.Strong,

    next_pending: ?*DNSLookup = null,
    name_hash: u64 = 0,
    cache: CacheConfig = CacheConfig{},

    resolver_for_caching: ?*DNSResolver = null,

    poll_ref_machport: ?*bun.JSC.FilePoll = null,
    poll_ref_machport_id: ?*anyopaque = null,

    pub fn getAddrInfoAsyncCallback(
        status: i32,
        addr_info: ?*std.c.addrinfo,
        arg: ?*anyopaque,
    ) callconv(.C) void {
        const this = @intToPtr(*DNSLookup, @ptrToInt(arg));
        log("getAddrInfoAsyncCallback: status={d}", .{status});

        this.onGetAddrInfoNative(status, addr_info);
        if (addr_info != null) std.c.freeaddrinfo(addr_info.?);
    }

    extern fn getaddrinfo_send_reply(*anyopaque, *const LibInfo.GetaddrinfoAsyncHandleReply) bool;
    pub fn onMachportChange(this: *DNSLookup) void {
        if (!getaddrinfo_send_reply(this.poll_ref_machport_id.?, LibInfo.getaddrinfo_async_handle_reply().?)) {
            log("onMachportChange: getaddrinfo_send_reply failed", .{});
            this.processGetAddrInfoNative(-1, null);
            return;
        } else {
            log("onMachportChange: getaddrinfo_send_reply succeeded", .{});
        }
    }

    pub const CacheConfig = packed struct(u16) {
        pending_cache: bool = false,
        entry_cache: bool = false,
        pos_in_pending: u5 = 0,
        name_len: u9 = 0,
    };

    pub const PendingCacheKey = struct {
        name_hash: u64,
        len: u16,
        lookup: *DNSLookup = undefined,

        pub fn init(name: []const u8, lookup: *DNSLookup) PendingCacheKey {
            return PendingCacheKey{
                .name_hash = std.hash.Wyhash.hash(0, name),
                .len = @truncate(u16, name.len),
                .lookup = lookup,
            };
        }
    };

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

            this.deinit();

            promise.reject(globalThis, error_value);
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

            this.deinit();
            promise.reject(globalThis, error_value);
            return;
        }

        this.onComplete(result.?);
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

        this.onCompleteNative(result.?);
    }

    pub fn onGetAddrInfoNative(this: *DNSLookup, status: i32, result: ?*std.c.addrinfo) void {
        if (this.resolver_for_caching) |resolver| {
            // if (this.cache.entry_cache and result != null and result.?.node != null) {
            //     resolver.putEntryInCache(this.name_hash, this.cache.name_len, result.?);
            // }

            if (this.cache.pending_cache) {
                resolver.drainPendingHostNative(this.cache.pos_in_pending, this.globalThis, status, result);
                return;
            }
        }

        this.processGetAddrInfoNative(status, result);
    }

    pub fn onGetAddrInfo(this: *DNSLookup, err_: ?c_ares.Error, timeout: i32, result: ?*c_ares.AddrInfo) void {
        if (this.resolver_for_caching) |resolver| {
            // if (this.cache.entry_cache and result != null and result.?.node != null) {
            //     resolver.putEntryInCache(this.name_hash, this.cache.name_len, result.?);
            // }

            if (this.cache.pending_cache) {
                resolver.drainPendingHostCares(this.cache.pos_in_pending, this.globalThis, err_, timeout, result);
                return;
            }
        }

        this.processGetAddrInfo(err_, timeout, result);
        if (result) |res| res.deinit();
    }

    pub const Result = struct {
        address: std.net.Address,
        ttl: i32 = 0,

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

    pub fn onComplete(this: *DNSLookup, result: *c_ares.AddrInfo) void {
        const array = result.toJSArray(this.globalThis.allocator(), this.globalThis);
        this.onCompleteWithArray(array);
    }

    pub fn onCompleteNative(this: *DNSLookup, result: *std.c.addrinfo) void {
        const array = addrInfoToJSArray(this.globalThis.allocator(), result, this.globalThis);
        this.onCompleteWithArray(array);
    }

    pub fn onCompleteWithArray(this: *DNSLookup, result: JSC.JSValue) void {
        var promise = this.promise;
        var globalThis = this.globalThis;
        this.promise = .{};

        this.deinit();
        promise.resolve(globalThis, result);
    }

    pub fn deinit(this: *DNSLookup) void {
        this.poll_ref.unref(this.globalThis.bunVM());
        if (this.poll_ref_machport) |port| {
            port.deinit();
        }
        bun.default_allocator.destroy(this);
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
    // entry_host_cache: std.BoundedArray(128)

    const PendingCache = bun.HiveArray(DNSLookup.PendingCacheKey, 32);

    pub fn drainPendingHostCares(this: *DNSResolver, index: u8, globalObject: *JSC.JSGlobalObject, err: ?c_ares.Error, timeout: i32, result: ?*c_ares.AddrInfo) void {
        const key: DNSLookup.PendingCacheKey = brk: {
            std.debug.assert(!this.pending_host_cache_cares.available.isSet(index));
            const entry = this.pending_host_cache_cares.buffer[index];
            this.pending_host_cache_cares.buffer[index] = undefined;
            this.pending_host_cache_cares.available.unset(index);
            break :brk entry;
        };

        var addr = result orelse {
            var pending: ?*DNSLookup = key.lookup.next_pending;
            key.lookup.processGetAddrInfo(err, timeout, null);

            while (pending) |value| {
                pending = value.next_pending;
                value.processGetAddrInfo(err, timeout, null);
            }
            return;
        };

        var array = addr.toJSArray(this.vm.allocator, globalObject);
        defer addr.deinit();
        array.ensureStillAlive();
        key.lookup.onCompleteWithArray(array);
        array.ensureStillAlive();
        // std.c.addrinfo

        var pending: ?*DNSLookup = key.lookup.next_pending;
        var prev_global = key.lookup.globalThis;
        while (pending) |value| {
            var new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addr.toJSArray(this.vm.allocator, new_global);
                prev_global = new_global;
            }
            array.ensureStillAlive();
            value.onCompleteWithArray(array);
            array.ensureStillAlive();
            pending = value.next_pending;
        }
    }

    pub fn drainPendingHostNative(this: *DNSResolver, index: u8, globalObject: *JSC.JSGlobalObject, err: i32, result: ?*std.c.addrinfo) void {
        const key: DNSLookup.PendingCacheKey = brk: {
            std.debug.assert(!this.pending_host_cache_native.available.isSet(index));
            const entry = this.pending_host_cache_native.buffer[index];
            this.pending_host_cache_native.buffer[index] = undefined;
            this.pending_host_cache_native.available.unset(index);
            break :brk entry;
        };

        var addr = result orelse {
            var pending: ?*DNSLookup = key.lookup.next_pending;
            key.lookup.processGetAddrInfoNative(err, null);

            while (pending) |value| {
                pending = value.next_pending;
                value.processGetAddrInfoNative(err, null);
            }

            return;
        };

        var array = addrInfoToJSArray(this.vm.allocator, addr, globalObject);
        array.ensureStillAlive();
        key.lookup.onCompleteWithArray(array);
        array.ensureStillAlive();
        // std.c.addrinfo

        var pending: ?*DNSLookup = key.lookup.next_pending;
        var prev_global = key.lookup.globalThis;
        while (pending) |value| {
            var new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addrInfoToJSArray(this.vm.allocator, addr, new_global);
                prev_global = new_global;
            }
            array.ensureStillAlive();
            value.onCompleteWithArray(array);
            array.ensureStillAlive();
            pending = value.next_pending;
        }
    }

    pub fn getOrPutIntoPendingCache(
        this: *DNSResolver,
        key: DNSLookup.PendingCacheKey,
        value: *DNSLookup,
        comptime field: std.meta.FieldEnum(DNSResolver),
    ) bool {
        value.cache.name_len = @truncate(u9, key.len);
        value.name_hash = key.name_hash;

        var cache: *PendingCache = &@field(this, @tagName(field));

        var available_iter = cache.available.iterator(.{});

        while (available_iter.next()) |index| {
            const entry: DNSLookup.PendingCacheKey = cache.buffer[index];
            if (entry.name_hash == key.name_hash and entry.len == key.len) {
                if (entry.lookup.next_pending) |prev| {
                    prev.next_pending = value;
                } else {
                    entry.lookup.next_pending = value;
                }
                return true;
            }
        }

        value.poll_ref.ref(this.vm);
        value.resolver_for_caching = this;

        if (cache.get()) |new| {
            value.cache.pending_cache = true;
            value.cache.pos_in_pending = @truncate(
                @TypeOf(value.cache.pos_in_pending),
                cache.indexOf(new).?,
            );

            new.* = key;
            new.lookup = value;
        }

        return false;
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

        if ((!readable and poll.flags.contains(.poll_readable)) or (!writable and poll.flags.contains(.poll_writable))) {
            _ = poll.unregister(vm.uws_event_loop.?);
        }

        if (readable)
            _ = poll.register(vm.uws_event_loop.?, .readable, false);

        if (writable)
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

    pub const GetAddrInfoBackend = enum {
        c_ares,
        system,

        pub const label = bun.ComptimeStringMap(GetAddrInfoBackend, .{
            .{ "c-ares", .c_ares },
            .{ "cares", .c_ares },
            .{ "async", .c_ares },
            .{ "system", default_backend },
        });

        pub const default_backend: GetAddrInfoBackend = if (Environment.isMac)
            GetAddrInfoBackend.system
        else
            GetAddrInfoBackend.c_ares;
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
        _ = record_type;

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

        // const name = name_str.toSliceZ(globalThis).cloneZ(bun.default_allocator) catch unreachable;
        // TODO:
        return JSC.JSValue.jsUndefined();
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

        var backend = GetAddrInfoBackend.default_backend;

        if (arguments.len > 1 and arguments.ptr[1].isCell()) {
            if (arguments.ptr[1].get(globalThis, "backend")) |backend_value| {
                if (!backend_value.isEmptyOrUndefinedOrNull() and backend_value.isString()) {
                    var str = backend_value.getZigString(globalThis);
                    backend = GetAddrInfoBackend.label.getWithEql(str, JSC.ZigString.eqlComptime) orelse {
                        globalThis.throwInvalidArgumentType("lookup", "backend", "one of: async or system");
                        return .zero;
                    };
                }
            }
        }

        const name = name_str.toSlice(globalThis, bun.default_allocator);
        defer name.deinit();
        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);

        return resolver.doLookup(backend, name.slice(), globalThis);
    }

    pub fn doLookup(this: *DNSResolver, preferred_backend_: GetAddrInfoBackend, name: []const u8, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        var backend = preferred_backend_;
        const normalized = normalizeDNSName(name);
        if (normalized.ptr != name.ptr) {
            if (backend == .c_ares) {
                backend = .system;
            }
        }

        return switch (backend) {
            .c_ares => this.c_aresLookupWithNormalizedName(normalized, globalThis),
            .system => if (comptime Environment.isMac)
                this.nativeLookupWithNormalizedName(normalized, globalThis)
            else
                this.libcLookupWithNormalizedName(normalized, globalThis),
        };
    }

    pub fn libcLookupWithNormalizedName(_: *DNSResolver, _: []const u8, _: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.JSValue.jsUndefined();
    }

    pub fn nativeLookupWithNormalizedName(this: *DNSResolver, name: []const u8, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const getaddrinfo_async_start = LibInfo.getaddrinfo_async_start() orelse {
            return JSC.JSValue.jsUndefined();
        };

        if (name.len > 1023) {
            globalThis.throwInvalidArgumentType("lookup", "name", "name must be less than 1024 bytes");
            return .zero;
        }

        var promise = JSC.JSPromise.Strong.init(globalThis);
        var promise_value = promise.value();
        var dns = this.vm.allocator.create(DNSLookup) catch unreachable;
        dns.* = .{ .promise = promise, .globalThis = globalThis, .cache = .{} };

        var key = DNSLookup.PendingCacheKey.init(name, undefined);

        if (!this.getOrPutIntoPendingCache(key, dns, .pending_host_cache_native)) {
            var name_buf: [1024]u8 = undefined;
            _ = strings.copy(name_buf[0..], name);

            var port: ?*anyopaque = null;
            name_buf[name.len] = 0;
            var name_z = name_buf[0..name.len :0];

            const errno = getaddrinfo_async_start(&port, name_z.ptr, null, null, DNSLookup.getAddrInfoAsyncCallback, dns);
            if (errno != 0) {
                promise.reject(globalThis, globalThis.createErrorInstance("getaddrinfo_async_start error: {s}", .{@tagName(std.c.getErrno(errno))}));
                promise.strong.deinit();
                this.vm.allocator.destroy(dns);
                this.pending_host_cache_native.available.set(dns.cache.pos_in_pending);
                return promise_value;
            }
            std.debug.assert(port != null);

            var poll_ref = bun.JSC.FilePoll.init(this.vm, std.math.maxInt(i32) - 1, .{}, DNSLookup, dns);
            std.debug.assert(poll_ref.registerWithFd(this.vm.uws_event_loop.?, .machport, true, @ptrToInt(port)) == .result);

            dns.poll_ref_machport = poll_ref;
            dns.poll_ref_machport_id = port;
        }

        return promise_value;
    }

    pub fn c_aresLookupWithNormalizedName(this: *DNSResolver, name: []const u8, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        var channel: *c_ares.Channel = switch (this.getChannel()) {
            .result => |res| res,
            .err => |err| {
                const system_error = JSC.SystemError{
                    .errno = -1,
                    .code = JSC.ZigString.init(err.code()),
                    .message = JSC.ZigString.init(err.label()),
                };

                return system_error.toErrorInstance(globalThis);
            },
        };

        var promise = JSC.JSPromise.Strong.init(globalThis);
        var promise_value = promise.value();
        var dns = this.vm.allocator.create(DNSLookup) catch unreachable;
        dns.* = .{ .promise = promise, .globalThis = globalThis, .cache = .{} };

        var key = DNSLookup.PendingCacheKey.init(name, undefined);

        if (!this.getOrPutIntoPendingCache(key, dns, .pending_host_cache_cares))
            channel.getAddrInfo(name, 0, &.{}, DNSLookup, dns, DNSLookup.onGetAddrInfo);

        return promise_value;
    }

    comptime {
        @export(
            lookup,
            .{
                .name = "Bun__DNSResolver__lookup",
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
