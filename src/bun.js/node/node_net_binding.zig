const std = @import("std");
const bun = @import("root").bun;
const C = bun.c;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const validators = @import("./util/validators.zig");
const SocketAddress = bun.JSC.GeneratedClassesList.SocketAddress;
const sockaddr = SocketAddress.sockaddr;

//
//

pub var autoSelectFamilyDefault: bool = true;

pub fn getDefaultAutoSelectFamily(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "getDefaultAutoSelectFamily", (struct {
        fn getter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            return JSC.jsBoolean(autoSelectFamilyDefault);
        }
    }).getter, 0, .{});
}

pub fn setDefaultAutoSelectFamily(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "setDefaultAutoSelectFamily", (struct {
        fn setter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments_old(1);
            if (arguments.len < 1) {
                return globalThis.throw("missing argument", .{});
            }
            const arg = arguments.slice()[0];
            if (!arg.isBoolean()) {
                return globalThis.throwInvalidArguments("autoSelectFamilyDefault", .{});
            }
            const value = arg.toBoolean();
            autoSelectFamilyDefault = value;
            return JSC.jsBoolean(value);
        }
    }).setter, 1, .{});
}

/// This is only used to provide the getDefaultAutoSelectFamilyAttemptTimeout and
/// setDefaultAutoSelectFamilyAttemptTimeout functions, not currently read by any other code. It's
/// `threadlocal` because Node.js expects each Worker to have its own copy of this, and currently
/// it can only be accessed by accessor functions which run on each Worker's main JavaScript thread.
///
/// If this becomes used in more places, and especially if it can be read by other threads, we may
/// need to store it as a field in the VirtualMachine instead of in a `threadlocal`.
pub threadlocal var autoSelectFamilyAttemptTimeoutDefault: u32 = 250;

pub fn getDefaultAutoSelectFamilyAttemptTimeout(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "getDefaultAutoSelectFamilyAttemptTimeout", (struct {
        fn getter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            return JSC.jsNumber(autoSelectFamilyAttemptTimeoutDefault);
        }
    }).getter, 0, .{});
}

pub fn setDefaultAutoSelectFamilyAttemptTimeout(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "setDefaultAutoSelectFamilyAttemptTimeout", (struct {
        fn setter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments_old(1);
            if (arguments.len < 1) {
                return globalThis.throw("missing argument", .{});
            }
            const arg = arguments.slice()[0];
            var value = try validators.validateInt32(globalThis, arg, "value", .{}, 1, null);
            if (value < 10) value = 10;
            autoSelectFamilyAttemptTimeoutDefault = @intCast(value);
            return JSC.jsNumber(value);
        }
    }).setter, 1, .{});
}

pub fn createBinding(global: *JSC.JSGlobalObject) JSC.JSValue {
    const net = JSC.JSValue.createEmptyObjectWithNullPrototype(global);

    net.put(global, "SocketAddress", SocketAddress.getConstructor(global));

    return net;
}

pub const BlockList = JSC.Codegen.JSBlockList.getConstructor;

pub const SBlockList = struct {
    pub usingnamespace bun.NewThreadSafeRefCounted(@This(), deinit, null);
    pub usingnamespace JSC.Codegen.JSBlockList;

    ref_count: std.atomic.Value(u32) = .init(1),
    globalThis: *JSC.JSGlobalObject,
    da_rules: std.ArrayList(Rule),
    mutex: std.Thread.Mutex = .{},

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!*@This() {
        _ = callFrame;
        const ptr = @This().new(.{
            .globalThis = globalThis,
            .da_rules = .init(bun.default_allocator),
        });
        return ptr;
    }

    pub fn estimatedSize(this: *@This()) usize {
        this.mutex.lock();
        defer this.mutex.unlock();
        return @sizeOf(@This()) + (@sizeOf(Rule) * this.da_rules.items.len);
    }

    pub fn finalize(this: *@This()) void {
        this.deref();
    }

    pub fn deinit(this: *@This()) void {
        this.da_rules.deinit();
        this.destroy();
    }

    pub fn isBlockList(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        _ = globalThis;
        const value = callframe.argumentsAsArray(1)[0];
        return .jsBoolean(value.as(@This()) != null);
    }

    // [kInspect](depth, options)
    pub fn customInspect(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        @panic("TODO");
    }

    pub fn addAddress(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        this.mutex.lock();
        defer this.mutex.unlock();
        const arguments = callframe.argumentsAsArray(2);
        const address_js, var family_js = arguments;
        var new_address = false;
        if (family_js.isUndefined()) family_js = bun.String.static("ipv4").toJS(globalThis);
        const address = address_js.as(SocketAddress) orelse blk: {
            new_address = true;
            try validators.validateString(globalThis, address_js, "address", .{});
            try validators.validateString(globalThis, family_js, "family", .{});
            break :blk try SocketAddress.createFromAddrFamily(globalThis, address_js, family_js);
        };
        defer if (new_address) address.destroy();
        try this.da_rules.insert(0, .{ .addr = address._addr });
        return .jsUndefined();
    }

    pub fn addRange(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        this.mutex.lock();
        defer this.mutex.unlock();
        const arguments = callframe.argumentsAsArray(3);
        const start_js, const end_js, var family_js = arguments;
        var new_start = false;
        var new_end = false;
        if (family_js.isUndefined()) family_js = bun.String.static("ipv4").toJS(globalThis);
        const start = start_js.as(SocketAddress) orelse blk: {
            new_start = true;
            try validators.validateString(globalThis, start_js, "start", .{});
            try validators.validateString(globalThis, family_js, "family", .{});
            break :blk try SocketAddress.createFromAddrFamily(globalThis, start_js, family_js);
        };
        defer if (new_start) start.destroy();
        const end = end_js.as(SocketAddress) orelse blk: {
            new_end = true;
            try validators.validateString(globalThis, end_js, "end", .{});
            try validators.validateString(globalThis, family_js, "family", .{});
            break :blk try SocketAddress.createFromAddrFamily(globalThis, end_js, family_js);
        };
        defer if (new_end) end.destroy();
        if (_compare(start._addr, end._addr)) |ord| {
            if (ord.compare(.gt)) {
                return globalThis.throwInvalidArgumentValueCustom("start", start_js, "must come before end");
            }
        }
        try this.da_rules.insert(0, .{ .range = .{ .start = start._addr, .end = end._addr } });
        return .jsUndefined();
    }

    pub fn addSubnet(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        this.mutex.lock();
        defer this.mutex.unlock();
        const arguments = callframe.argumentsAsArray(3);
        const network_js, const prefix_js, var family_js = arguments;
        var new_network = false;
        if (family_js.isUndefined()) family_js = bun.String.static("ipv4").toJS(globalThis);
        const network = network_js.as(SocketAddress) orelse blk: {
            new_network = true;
            try validators.validateString(globalThis, network_js, "network", .{});
            try validators.validateString(globalThis, family_js, "family", .{});
            break :blk try SocketAddress.createFromAddrFamily(globalThis, network_js, family_js);
        };
        defer if (new_network) network.destroy();
        var prefix: u8 = 0;
        switch (network._addr.sin.family) {
            std.posix.AF.INET => prefix = @intCast(try validators.validateInt32(globalThis, prefix_js, "prefix", .{}, 0, 32)),
            std.posix.AF.INET6 => prefix = @intCast(try validators.validateInt32(globalThis, prefix_js, "prefix", .{}, 0, 128)),
            else => {},
        }
        try this.da_rules.insert(0, .{ .subnet = .{ .network = network._addr, .prefix = prefix } });
        return .jsUndefined();
    }

    pub fn check(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        this.mutex.lock();
        defer this.mutex.unlock();
        const arguments = callframe.argumentsAsArray(2);
        const address_js, var family_js = arguments;
        var new_address = false;
        if (family_js.isUndefined()) family_js = bun.String.static("ipv4").toJS(globalThis);
        const address = address_js.as(SocketAddress) orelse blk: {
            new_address = true;
            try validators.validateString(globalThis, address_js, "address", .{});
            try validators.validateString(globalThis, family_js, "family", .{});
            break :blk SocketAddress.createFromAddrFamily(globalThis, address_js, family_js) catch |err| {
                bun.debugAssert(err == error.JSError);
                globalThis.clearException();
                return .jsBoolean(false);
            };
        };
        defer if (new_address) address.destroy();
        for (this.da_rules.items) |item| {
            switch (item) {
                .addr => |a| {
                    const order = _compare(address._addr, a) orelse continue;
                    if (order.compare(.eq)) return .jsBoolean(true);
                },
                .range => |r| {
                    const os = _compare(address._addr, r.start) orelse continue;
                    const oe = _compare(address._addr, r.end) orelse continue;
                    if (os.compare(.gte) and oe.compare(.lte)) return .jsBoolean(true);
                },
                .subnet => |s| {
                    if (s.network.as_v4()) |a_l| if (address._addr.as_v4()) |a_r| {
                        const set_net = std.bit_set.IntegerBitSet(32){ .mask = @byteSwap(@bitReverse(a_l)) };
                        const set_adr = std.bit_set.IntegerBitSet(32){ .mask = @byteSwap(@bitReverse(a_r)) };
                        const intersection = set_net.xorWith(set_adr);
                        const t = @ctz(intersection.mask);
                        const h = t >= s.prefix;
                        if (h) return .jsBoolean(true);
                    };
                    if (address._addr.sin.family == std.posix.AF.INET6 and s.network.sin.family == std.posix.AF.INET6) {
                        const set_net = std.bit_set.IntegerBitSet(128){ .mask = @byteSwap(@bitReverse(@as(u128, @bitCast(s.network.sin6.addr)))) };
                        const set_adr = std.bit_set.IntegerBitSet(128){ .mask = @byteSwap(@bitReverse(@as(u128, @bitCast(address._addr.sin6.addr)))) };
                        const intersection = set_net.xorWith(set_adr);
                        const t = @ctz(intersection.mask);
                        const h = t >= s.prefix;
                        if (h) return .jsBoolean(true);
                    }
                },
            }
        }
        return .jsBoolean(false);
    }

    pub fn rules(this: *@This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        this.mutex.lock();
        defer this.mutex.unlock();
        var list = std.ArrayList(JSC.JSValue).initCapacity(bun.default_allocator, this.da_rules.items.len) catch bun.outOfMemory();
        defer list.deinit();
        for (this.da_rules.items) |rule| {
            switch (rule) {
                .addr => |a| {
                    var buf: [SocketAddress.inet.INET6_ADDRSTRLEN]u8 = @splat(0);
                    list.appendAssumeCapacity(bun.String.createFormatForJS(globalThis, "Address: {s} {s}", .{ a.family().upper(), a.fmt(&buf) }));
                },
                .range => |r| {
                    var buf_s: [SocketAddress.inet.INET6_ADDRSTRLEN]u8 = @splat(0);
                    var buf_e: [SocketAddress.inet.INET6_ADDRSTRLEN]u8 = @splat(0);
                    list.appendAssumeCapacity(bun.String.createFormatForJS(globalThis, "Range: {s} {s}-{s}", .{ r.start.family().upper(), r.start.fmt(&buf_s), r.end.fmt(&buf_e) }));
                },
                .subnet => |s| {
                    var buf: [SocketAddress.inet.INET6_ADDRSTRLEN]u8 = @splat(0);
                    list.appendAssumeCapacity(bun.String.createFormatForJS(globalThis, "Subnet: {s} {s}/{d}", .{ s.network.family().upper(), s.network.fmt(&buf), s.prefix }));
                },
            }
        }
        return JSC.JSArray.create(globalThis, list.items);
    }

    pub fn onStructuredCloneSerialize(this: *@This(), globalThis: *JSC.JSGlobalObject, ctx: *anyopaque, writeBytes: *const fn (*anyopaque, ptr: [*]const u8, len: u32) callconv(JSC.conv) void) void {
        _ = globalThis;
        this.mutex.lock();
        defer this.mutex.unlock();
        this.ref();
        const writer = StructuredCloneWriter.Writer{ .context = .{ .ctx = ctx, .impl = writeBytes } };
        try writer.writeInt(usize, @intFromPtr(this), .little);
    }

    const StructuredCloneWriter = struct {
        ctx: *anyopaque,
        impl: *const fn (*anyopaque, ptr: [*]const u8, len: u32) callconv(JSC.conv) void,

        pub const Writer = std.io.Writer(@This(), Error, write);
        pub const Error = error{};

        fn write(this: StructuredCloneWriter, bytes: []const u8) Error!usize {
            this.impl(this.ctx, bytes.ptr, @as(u32, @truncate(bytes.len)));
            return bytes.len;
        }
    };

    pub fn onStructuredCloneDeserialize(globalThis: *JSC.JSGlobalObject, ptr: [*]u8, end: [*]u8) bun.JSError!JSC.JSValue {
        const total_length: usize = @intFromPtr(end) - @intFromPtr(ptr);
        var buffer_stream = std.io.fixedBufferStream(ptr[0..total_length]);
        const reader = buffer_stream.reader();

        const int = reader.readInt(usize, .little) catch return globalThis.throw("BlockList.onStructuredCloneDeserialize failed", .{});
        const this: *@This() = @ptrFromInt(int);
        return this.toJS(globalThis);
    }

    pub const Rule = union(enum) {
        addr: sockaddr,
        range: struct { start: sockaddr, end: sockaddr },
        subnet: struct { network: sockaddr, prefix: u8 },
    };

    fn _compare(l: sockaddr, r: sockaddr) ?std.math.Order {
        if (l.as_v4()) |l_4| if (r.as_v4()) |r_4| return std.math.order(@byteSwap((l_4)), @byteSwap((r_4)));
        if (l.sin.family == std.posix.AF.INET6 and r.sin.family == std.posix.AF.INET6) return _compare_ipv6(l.sin6, r.sin6);
        return null;
    }

    fn _compare_ipv6(l: sockaddr.in6, r: sockaddr.in6) std.math.Order {
        return std.math.order(@byteSwap((@as(u128, @bitCast(l.addr)))), @byteSwap((@as(u128, @bitCast(r.addr)))));
    }
};
