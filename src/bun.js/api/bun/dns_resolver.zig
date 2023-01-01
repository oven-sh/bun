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

pub const DNSLookup = struct {
    const log = Output.scoped(.DNSLookup, true);

    ttl: u32 = 0,

    globalThis: *JSC.JSGlobalObject = undefined,
    poll_ref: *bun.JSC.FilePoll = undefined,

    first_result: Result = undefined,
    results: std.ArrayListUnmanaged(Result) = .{},

    promise: JSC.JSPromise.Strong,

    pub const Result = struct {
        address: std.net.Address,
        ttl: u32 = 0,
        interface: u16 = 0,

        pub fn toJS(this: *const Result, globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator) JSValue {
            const obj = JSC.JSValue.createEmptyObject(globalThis, 3);
            obj.put(globalThis, JSC.ZigString.static("address"), addressToJS(allocator, this.address, globalThis));
            obj.put(globalThis, JSC.ZigString.static("family"), switch (this.address.any.family) {
                std.os.AF.INET => JSValue.jsNumber(4),
                std.os.AF.INET6 => JSValue.jsNumber(6),
                else => JSValue.jsNumber(0),
            });
            obj.put(globalThis, JSC.ZigString.static("ttl"), JSValue.jsNumber(this.ttl));
            obj.put(globalThis, JSC.ZigString.static("networkInterface"), JSValue.jsNumber(this.interface));
            return obj;
        }
    };

    pub fn onComplete(this: *DNSLookup) void {
        const err = this.err;
        var promise = this.promise;
        var globalThis = this.globalThis;
        this.promise = .{};

        if (err != .NoError) {
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

        const result: JSC.JSValue = brk: {
            var stack = std.heap.stackFallback(2048, default_allocator);
            var arena = std.heap.ArenaAllocator.init(stack.get());
            const array = JSC.JSValue.createEmptyArray(globalThis, @truncate(u32, this.results.items.len));
            defer arena.deinit();
            var allocator = arena.allocator();
            if (this.results.items.len == 1) {
                array.putIndex(globalThis, 0, this.first_result.toJS(globalThis, allocator));
            } else if (this.results.items.len > 0) {
                for (this.results.items) |res, i| {
                    array.putIndex(globalThis, @truncate(u32, i), res.toJS(globalThis, allocator));
                }
            }

            break :brk array;
        };
        this.deinit();
        promise.resolve(globalThis, result);
    }

    pub fn deinit(this: *DNSLookup) void {
        this.poll_ref.deinit();
        if (this.results.items.len > 1) {
            this.results.deinit(bun.default_allocator);
        }

        bun.default_allocator.destroy(this);
    }
};

pub const DNSResolver = struct {
    const log = Output.scoped(.DNSResolver, true);
    const DNSQuery = struct {
        name: JSC.ZigString.Slice,
        record_type: RecordType,

        ttl: u32 = 0,
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

        const name = name_str.toSliceZ(globalThis, bun.default_allocator).cloneZ(bun.default_allocator) catch unreachable;
        _ = name;

        // TODO:
        return JSC.JSValue.jsUndefined();
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
