const RefCount = bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{});
pub const new = bun.TrivialNew(@This());
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const fromJS = js.fromJS;
pub const toJS = js.toJS;

ref_count: RefCount = .init(),
globalThis: *jsc.JSGlobalObject,
da_rules: std.array_list.Managed(Rule),
mutex: bun.Mutex = .{},

/// We cannot lock/unlock a mutex
estimated_size: std.atomic.Value(u32) = .init(0),

pub fn constructor(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!*@This() {
    _ = callFrame;
    const ptr = @This().new(.{
        .globalThis = globalThis,
        .da_rules = .init(bun.default_allocator),
    });
    return ptr;
}

/// May be called from any thread.
pub fn estimatedSize(this: *@This()) usize {
    return (@sizeOf(@This()) + this.estimated_size.load(.seq_cst)) / this.ref_count.get();
}

pub fn finalize(this: *@This()) void {
    this.deref();
}

pub fn deinit(this: *@This()) void {
    this.da_rules.deinit();
    bun.destroy(this);
}

pub fn isBlockList(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    _ = globalThis;
    const value = callframe.argumentsAsArray(1)[0];
    return .jsBoolean(value.as(@This()) != null);
}

pub fn addAddress(this: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.argumentsAsArray(2);
    const address_js, var family_js = arguments;
    if (family_js.isUndefined()) family_js = try bun.String.static("ipv4").toJS(globalThis);
    const address = if (address_js.as(SocketAddress)) |sa| sa._addr else blk: {
        try validators.validateString(globalThis, address_js, "address", .{});
        try validators.validateString(globalThis, family_js, "family", .{});
        break :blk (try SocketAddress.initFromAddrFamily(globalThis, address_js, family_js))._addr;
    };

    this.mutex.lock();
    defer this.mutex.unlock();
    try this.da_rules.insert(0, .{ .addr = address });
    _ = this.estimated_size.fetchAdd(@sizeOf(Rule), .monotonic);
    return .js_undefined;
}

pub fn addRange(this: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.argumentsAsArray(3);
    const start_js, const end_js, var family_js = arguments;
    if (family_js.isUndefined()) family_js = try bun.String.static("ipv4").toJS(globalThis);
    const start = if (start_js.as(SocketAddress)) |sa| sa._addr else blk: {
        try validators.validateString(globalThis, start_js, "start", .{});
        try validators.validateString(globalThis, family_js, "family", .{});
        break :blk (try SocketAddress.initFromAddrFamily(globalThis, start_js, family_js))._addr;
    };
    const end = if (end_js.as(SocketAddress)) |sa| sa._addr else blk: {
        try validators.validateString(globalThis, end_js, "end", .{});
        try validators.validateString(globalThis, family_js, "family", .{});
        break :blk (try SocketAddress.initFromAddrFamily(globalThis, end_js, family_js))._addr;
    };
    if (_compare(&start, &end)) |ord| {
        if (ord.compare(.gt)) {
            return globalThis.throwInvalidArgumentValueCustom("start", start_js, "must come before end");
        }
    }
    this.mutex.lock();
    defer this.mutex.unlock();
    try this.da_rules.insert(0, .{ .range = .{ .start = start, .end = end } });
    _ = this.estimated_size.fetchAdd(@sizeOf(Rule), .monotonic);
    return .js_undefined;
}

pub fn addSubnet(this: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.argumentsAsArray(3);
    const network_js, const prefix_js, var family_js = arguments;
    if (family_js.isUndefined()) family_js = try bun.String.static("ipv4").toJS(globalThis);
    const network = if (network_js.as(SocketAddress)) |sa| sa._addr else blk: {
        try validators.validateString(globalThis, network_js, "network", .{});
        try validators.validateString(globalThis, family_js, "family", .{});
        break :blk (try SocketAddress.initFromAddrFamily(globalThis, network_js, family_js))._addr;
    };
    var prefix: u8 = 0;
    switch (network.sin.family) {
        std.posix.AF.INET => prefix = @intCast(try validators.validateInt32(globalThis, prefix_js, "prefix", .{}, 0, 32)),
        std.posix.AF.INET6 => prefix = @intCast(try validators.validateInt32(globalThis, prefix_js, "prefix", .{}, 0, 128)),
        else => {},
    }
    this.mutex.lock();
    defer this.mutex.unlock();
    try this.da_rules.insert(0, .{ .subnet = .{ .network = network, .prefix = prefix } });
    _ = this.estimated_size.fetchAdd(@sizeOf(Rule), .monotonic);
    return .js_undefined;
}

pub fn check(this: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.argumentsAsArray(2);
    const address_js, var family_js = arguments;
    if (family_js.isUndefined()) family_js = try bun.String.static("ipv4").toJS(globalThis);
    const address = &(if (address_js.as(SocketAddress)) |sa| sa._addr else blk: {
        try validators.validateString(globalThis, address_js, "address", .{});
        try validators.validateString(globalThis, family_js, "family", .{});
        break :blk (SocketAddress.initFromAddrFamily(globalThis, address_js, family_js) catch |err| {
            bun.debugAssert(err == error.JSError);
            globalThis.clearException();
            return .false;
        })._addr;
    });
    this.mutex.lock();
    defer this.mutex.unlock();
    for (this.da_rules.items) |*item| {
        switch (item.*) {
            .addr => |*a| {
                const order = _compare(address, a) orelse continue;
                if (order.compare(.eq)) return .true;
            },
            .range => |*r| {
                const os = _compare(address, &r.start) orelse continue;
                const oe = _compare(address, &r.end) orelse continue;
                if (os.compare(.gte) and oe.compare(.lte)) return .true;
            },
            .subnet => |*s| {
                if (address.as_v4()) |ip_addr| if (s.network.as_v4()) |subnet_addr| {
                    if (s.prefix == 32) if (ip_addr == subnet_addr) (return .true) else continue;
                    const one: u32 = 1;
                    const mask_addr = ((one << @intCast(s.prefix)) - 1) << @intCast(32 - s.prefix);
                    const ip_net: u32 = @byteSwap(ip_addr) & mask_addr;
                    const subnet_net: u32 = @byteSwap(subnet_addr) & mask_addr;
                    if (ip_net == subnet_net) return .true;
                };
                if (address.sin.family == std.posix.AF.INET6 and s.network.sin.family == std.posix.AF.INET6) {
                    const ip_addr: u128 = @bitCast(address.sin6.addr);
                    const subnet_addr: u128 = @bitCast(s.network.sin6.addr);
                    if (s.prefix == 128) if (ip_addr == subnet_addr) (return .true) else continue;
                    const one: u128 = 1;
                    const mask_addr = ((one << @intCast(s.prefix)) - 1) << @intCast(128 - s.prefix);
                    const ip_net: u128 = @byteSwap(ip_addr) & mask_addr;
                    const subnet_net: u128 = @byteSwap(subnet_addr) & mask_addr;
                    if (ip_net == subnet_net) return .true;
                }
            },
        }
    }
    return .false;
}

pub fn rules(this: *@This(), globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {

    // GC must be able to visit
    var array = try jsc.JSArray.createEmpty(globalThis, 0);

    this.mutex.lock();
    defer this.mutex.unlock();
    for (this.da_rules.items) |*rule| {
        switch (rule.*) {
            .addr => |*a| {
                var buf: [SocketAddress.inet.INET6_ADDRSTRLEN]u8 = @splat(0);
                try array.push(globalThis, try bun.String.createFormatForJS(globalThis, "Address: {s} {s}", .{ a.family().upper(), a.fmt(&buf) }));
            },
            .range => |*r| {
                var buf_s: [SocketAddress.inet.INET6_ADDRSTRLEN]u8 = @splat(0);
                var buf_e: [SocketAddress.inet.INET6_ADDRSTRLEN]u8 = @splat(0);
                try array.push(globalThis, try bun.String.createFormatForJS(globalThis, "Range: {s} {s}-{s}", .{ r.start.family().upper(), r.start.fmt(&buf_s), r.end.fmt(&buf_e) }));
            },
            .subnet => |*s| {
                var buf: [SocketAddress.inet.INET6_ADDRSTRLEN]u8 = @splat(0);
                try array.push(globalThis, try bun.String.createFormatForJS(globalThis, "Subnet: {s} {s}/{d}", .{ s.network.family().upper(), s.network.fmt(&buf), s.prefix }));
            },
        }
    }
    return array;
}

pub fn onStructuredCloneSerialize(this: *@This(), globalThis: *jsc.JSGlobalObject, ctx: *anyopaque, writeBytes: *const fn (*anyopaque, ptr: [*]const u8, len: u32) callconv(jsc.conv) void) void {
    _ = globalThis;
    this.mutex.lock();
    defer this.mutex.unlock();
    this.ref();
    const writer = StructuredCloneWriter.Writer{ .context = .{ .ctx = ctx, .impl = writeBytes } };
    try writer.writeInt(usize, @intFromPtr(this), .little);
}

const StructuredCloneWriter = struct {
    ctx: *anyopaque,
    impl: *const fn (*anyopaque, ptr: [*]const u8, len: u32) callconv(jsc.conv) void,

    pub const Writer = std.Io.GenericWriter(@This(), Error, write);
    pub const Error = error{};

    fn write(this: StructuredCloneWriter, bytes: []const u8) Error!usize {
        this.impl(this.ctx, bytes.ptr, @as(u32, @truncate(bytes.len)));
        return bytes.len;
    }
};

pub fn onStructuredCloneDeserialize(globalThis: *jsc.JSGlobalObject, ptr: *[*]u8, end: [*]u8) bun.JSError!jsc.JSValue {
    const total_length: usize = @intFromPtr(end) - @intFromPtr(ptr.*);
    var buffer_stream = std.io.fixedBufferStream(ptr.*[0..total_length]);
    const reader = buffer_stream.reader();

    const int = reader.readInt(usize, .little) catch return globalThis.throw("BlockList.onStructuredCloneDeserialize failed", .{});

    // Advance the pointer by the number of bytes consumed
    ptr.* = ptr.* + buffer_stream.pos;

    const this: *@This() = @ptrFromInt(int);
    return this.toJS(globalThis);
}

pub const Rule = union(enum) {
    addr: sockaddr,
    range: struct { start: sockaddr, end: sockaddr },
    subnet: struct { network: sockaddr, prefix: u8 },
};

fn _compare(l: *const sockaddr, r: *const sockaddr) ?std.math.Order {
    if (l.as_v4()) |l_4| if (r.as_v4()) |r_4| return std.math.order(@byteSwap((l_4)), @byteSwap((r_4)));
    if (l.sin.family == std.posix.AF.INET6 and r.sin.family == std.posix.AF.INET6) return _compare_ipv6(&l.sin6, &r.sin6);
    return null;
}

fn _compare_ipv6(l: *const sockaddr.in6, r: *const sockaddr.in6) std.math.Order {
    return std.math.order(@byteSwap((@as(u128, @bitCast(l.addr)))), @byteSwap((@as(u128, @bitCast(r.addr)))));
}

const std = @import("std");
const validators = @import("../util/validators.zig");

const bun = @import("bun");
const jsc = bun.jsc;
const js = jsc.Codegen.JSBlockList;

const SocketAddress = bun.jsc.GeneratedClassesList.SocketAddress;
const sockaddr = SocketAddress.sockaddr;
