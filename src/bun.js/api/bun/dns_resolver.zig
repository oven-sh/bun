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
            else => return JSC.ZigString.Empty,
        }
    };

    return JSC.ZigString.init(str);
}

pub fn addressToJS(
    allocator: std.mem.Allocator,
    address: std.net.Address,
    globalThis: *JSC.JSGlobalObject,
) JSC.JSValue {
    return addressToString(allocator, address).toValueGC(globalThis);
}

pub fn addrInfoToJSArray(
    parent_allocator: std.mem.Allocator,
    globalThis: *JSC.JSGlobalObject,
    addr_info: *c_ares.AddrInfo,
) JSC.JSValue {
    var stack = std.heap.stackFallback(2048, parent_allocator);
    var arena = std.heap.ArenaAllocator.init(stack.get());
    var node = addr_info.node.?;
    const array = JSC.JSValue.createEmptyArray(
        globalThis,
        node.count(),
    );

    {
        defer arena.deinit();

        var allocator = arena.allocator();
        var j: u32 = 0;
        var current: ?*c_ares.AddrInfo_node = addr_info.node;
        while (current) |this_node| : (current = this_node.next) {
            array.putIndex(
                globalThis,
                j,
                DNSLookup.Result.toJS(
                    &.{
                        .address = switch (this_node.family) {
                            std.os.AF.INET => std.net.Address{ .in = .{ .sa = bun.cast(*const std.os.sockaddr.in, this_node.addr.?).* } },
                            std.os.AF.INET6 => std.net.Address{ .in6 = .{ .sa = bun.cast(*const std.os.sockaddr.in6, this_node.addr.?).* } },
                            else => unreachable,
                        },
                        .ttl = this_node.ttl,
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

    pub fn onGetAddrInfo(this: *DNSLookup, err_: ?c_ares.Error, timeout: i32, result: ?*c_ares.AddrInfo) void {
        if (this.resolver_for_caching) |resolver| {
            // if (this.cache.entry_cache and result != null and result.?.node != null) {
            //     resolver.putEntryInCache(this.name_hash, this.cache.name_len, result.?);
            // }

            if (this.cache.pending_cache) {
                resolver.drainPendingHost(this.cache.pos_in_pending, this.globalThis, err_, timeout, result);
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
        const array = addrInfoToJSArray(this.globalThis.allocator(), this.globalThis, result);
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

    pending_host_cache: bun.HiveArray(DNSLookup.PendingCacheKey, 32) = bun.HiveArray(DNSLookup.PendingCacheKey, 32).init(),
    // entry_host_cache: std.BoundedArray(128)

    pub fn drainPendingHost(this: *DNSResolver, index: u8, globalObject: *JSC.JSGlobalObject, err: ?c_ares.Error, timeout: i32, result: ?*c_ares.AddrInfo) void {
        const key: DNSLookup.PendingCacheKey = brk: {
            std.debug.assert(!this.pending_host_cache.available.isSet(index));
            const entry = this.pending_host_cache.buffer[index];
            this.pending_host_cache.buffer[index] = undefined;
            this.pending_host_cache.available.unset(index);
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

        var array = addrInfoToJSArray(this.vm.allocator, globalObject, addr);
        array.ensureStillAlive();
        key.lookup.onCompleteWithArray(array);
        array.ensureStillAlive();

        var pending: ?*DNSLookup = key.lookup.next_pending;
        var prev_global = key.lookup.globalThis;
        while (pending) |value| {
            var new_global = value.globalThis;
            if (prev_global != new_global) {
                array = addrInfoToJSArray(this.vm.allocator, new_global, addr);
                prev_global = new_global;
            }
            array.ensureStillAlive();
            value.onCompleteWithArray(array);
            array.ensureStillAlive();
            pending = value.next_pending;
        }
    }

    pub fn getOrPutIntoPendingCache(this: *DNSResolver, key: DNSLookup.PendingCacheKey, value: *DNSLookup) bool {
        value.cache.name_len = @truncate(u9, key.len);
        value.name_hash = key.name_hash;

        var available_iter = this.pending_host_cache.available.iterator(.{});

        while (available_iter.next()) |index| {
            const entry: DNSLookup.PendingCacheKey = this.pending_host_cache.buffer[index];
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

        if (this.pending_host_cache.get()) |new| {
            value.cache.pending_cache = true;
            value.cache.pos_in_pending = @truncate(
                @TypeOf(value.cache.pos_in_pending),
                this.pending_host_cache.indexOf(new).?,
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

        const name = name_str.toSlice(globalThis, bun.default_allocator);
        defer name.deinit();
        var vm = globalThis.bunVM();
        var resolver = vm.rareData().globalDNSResolver(vm);
        var channel: *c_ares.Channel = switch (resolver.getChannel()) {
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
        var dns = vm.allocator.create(DNSLookup) catch unreachable;
        dns.* = .{ .promise = promise, .globalThis = globalThis, .cache = .{} };

        var key = DNSLookup.PendingCacheKey.init(name.slice(), undefined);

        if (!resolver.getOrPutIntoPendingCache(key, dns))
            channel.getAddrInfo(name.slice(), 0, &.{}, DNSLookup, dns, DNSLookup.onGetAddrInfo);

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
