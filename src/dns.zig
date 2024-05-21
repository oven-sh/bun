const bun = @import("root").bun;
const std = @import("std");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;

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
        @memset(std.mem.asBytes(&hints)[0..@sizeOf(bun.c_ares.AddrInfo_hints)], 0);

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
            @memset(std.mem.asBytes(&hints)[0..@sizeOf(std.c.addrinfo)], 0);

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
                return map.fromJS(globalObject, value) orelse {
                    if (value.toString(globalObject).length() == 0) {
                        return .unspecified;
                    }

                    return error.InvalidFamily;
                };
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
                return map.fromJS(globalObject, value) orelse {
                    if (value.toString(globalObject).length() == 0)
                        return .unspecified;

                    return error.InvalidSocketType;
                };
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
                return map.fromJS(globalObject, value) orelse {
                    const str = value.toString(globalObject);
                    if (str.length() == 0)
                        return .unspecified;

                    return error.InvalidProtocol;
                };
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

        pub const default: GetAddrInfo.Backend = switch (bun.Environment.os) {
            .mac, .windows => .system,
            else => .c_ares,
        };

        pub fn fromJS(value: JSC.JSValue, globalObject: *JSC.JSGlobalObject) !Backend {
            if (value.isEmptyOrUndefinedOrNull())
                return default;

            if (value.isString()) {
                return label.fromJS(globalObject, value) orelse {
                    if (value.toString(globalObject).length() == 0) {
                        return default;
                    }

                    return error.InvalidBackend;
                };
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

            pub fn toJS(this: *const Any, globalThis: *JSC.JSGlobalObject) ?JSC.JSValue {
                return switch (this.*) {
                    .addrinfo => |addrinfo| addrInfoToJSArray(addrinfo orelse return null, globalThis),
                    .list => |list| brk: {
                        const array = JSC.JSValue.createEmptyArray(globalThis, @as(u32, @truncate(list.items.len)));
                        var i: u32 = 0;
                        const items: []const Result = list.items;
                        for (items) |item| {
                            array.putIndex(globalThis, i, item.toJS(globalThis));
                            i += 1;
                        }
                        break :brk array;
                    },
                };
            }

            pub fn deinit(this: *const Any) void {
                switch (this.*) {
                    .addrinfo => |addrinfo| {
                        if (addrinfo) |a| {
                            std.c.freeaddrinfo(a);
                        }
                    },
                    .list => |list_| {
                        var list = list_;
                        list.clearAndFree();
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
                .address = std.net.Address.initPosix(@alignCast(addrinfo.addr orelse return null)),
                // no TTL in POSIX getaddrinfo()
                .ttl = 0,
            };
        }

        pub fn toJS(this: *const Result, globalThis: *JSC.JSGlobalObject) JSValue {
            const obj = JSC.JSValue.createEmptyObject(globalThis, 3);
            obj.put(globalThis, JSC.ZigString.static("address"), addressToJS(&this.address, globalThis));
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
const String = bun.String;
const default_allocator = bun.default_allocator;
pub fn addressToString(
    address: *const std.net.Address,
) !bun.String {
    switch (address.any.family) {
        std.os.AF.INET => {
            var self = address.in;
            const bytes = @as(*const [4]u8, @ptrCast(&self.sa.addr));
            return String.createFormat("{}.{}.{}.{}", .{
                bytes[0],
                bytes[1],
                bytes[2],
                bytes[3],
            });
        },
        std.os.AF.INET6 => {
            var stack = std.heap.stackFallback(512, default_allocator);
            const allocator = stack.get();
            var out = try std.fmt.allocPrint(allocator, "{any}", .{address.*});
            defer allocator.free(out);
            // TODO: this is a hack, fix it
            // This removes [.*]:port
            //              ^  ^^^^^^
            return String.createLatin1(out[1 .. out.len - 1 - std.fmt.count("{d}", .{address.in6.getPort()}) - 1]);
        },
        std.os.AF.UNIX => {
            if (comptime std.net.has_unix_sockets) {
                return String.createLatin1(&address.un.path);
            }

            return String.empty;
        },
        else => return String.empty,
    }
}

pub fn addressToJS(
    address: *const std.net.Address,
    globalThis: *JSC.JSGlobalObject,
) JSC.JSValue {
    const str = addressToString(address) catch {
        globalThis.throwOutOfMemory();
        return .zero;
    };
    defer str.deref();
    return str.toJS(globalThis);
}

fn addrInfoCount(addrinfo: *std.c.addrinfo) u32 {
    var count: u32 = 1;
    var current: ?*std.c.addrinfo = addrinfo.next;
    while (current != null) : (current = current.?.next) {
        count += @intFromBool(current.?.addr != null);
    }
    return count;
}

pub fn addrInfoToJSArray(
    addr_info: *std.c.addrinfo,
    globalThis: *JSC.JSGlobalObject,
) JSC.JSValue {
    const array = JSC.JSValue.createEmptyArray(
        globalThis,
        addrInfoCount(addr_info),
    );

    {
        var j: u32 = 0;
        var current: ?*std.c.addrinfo = addr_info;
        while (current) |this_node| : (current = current.?.next) {
            array.putIndex(
                globalThis,
                j,
                GetAddrInfo.Result.toJS(
                    &(GetAddrInfo.Result.fromAddrInfo(this_node) orelse continue),
                    globalThis,
                ),
            );
            j += 1;
        }
    }

    return array;
}

pub const internal = bun.JSC.DNS.InternalDNS;
