//! `fromJS`/`toJS` for `GetAddrInfo` and its nested option types, plus
//! `addressToJS`/`addrInfoToJSArray`. The pure types stay in `src/dns/`.

pub fn optionsFromJS(value: jsc.JSValue, globalObject: *jsc.JSGlobalObject) FromJSError!Options {
    if (value.isEmptyOrUndefinedOrNull())
        return Options{};

    if (value.isObject()) {
        var options = Options{};

        if (try value.get(globalObject, "family")) |family| {
            options.family = try Family.fromJS(family, globalObject);
        }

        if (try value.get(globalObject, "socketType") orelse try value.get(globalObject, "socktype")) |socktype| {
            options.socktype = try SocketType.fromJS(socktype, globalObject);
        }

        if (try value.get(globalObject, "protocol")) |protocol| {
            options.protocol = try Protocol.fromJS(protocol, globalObject);
        }

        if (try value.get(globalObject, "backend")) |backend| {
            options.backend = try Backend.fromJS(backend, globalObject);
        }

        if (try value.get(globalObject, "flags")) |flags| {
            if (!flags.isNumber())
                return error.InvalidFlags;

            options.flags = try flags.coerce(std.c.AI, globalObject);

            // hints & ~(AI_ADDRCONFIG | AI_ALL | AI_V4MAPPED)) !== 0
            const filter = ~@as(u32, @bitCast(std.c.AI{ .ALL = true, .ADDRCONFIG = true, .V4MAPPED = true }));
            const int = @as(u32, @bitCast(options.flags));
            if (int & filter != 0) return error.InvalidFlags;
        }

        return options;
    }

    return error.InvalidOptions;
}
pub fn familyFromJS(value: jsc.JSValue, globalObject: *jsc.JSGlobalObject) FromJSError!Family {
    if (value.isEmptyOrUndefinedOrNull())
        return .unspecified;

    if (value.isNumber()) {
        return switch (try value.coerce(i32, globalObject)) {
            0 => .unspecified,
            4 => .inet,
            6 => .inet6,
            else => return error.InvalidFamily,
        };
    }

    if (value.isString()) {
        return try Family.map.fromJS(globalObject, value) orelse {
            if ((try value.toJSString(globalObject)).length() == 0) {
                return .unspecified;
            }

            return error.InvalidFamily;
        };
    }

    return error.InvalidFamily;
}
pub fn socketTypeFromJS(value: jsc.JSValue, globalObject: *jsc.JSGlobalObject) FromJSError!SocketType {
    if (value.isEmptyOrUndefinedOrNull())
        // Default to .stream
        return .stream;

    if (value.isNumber()) {
        return switch (value.to(i32)) {
            0 => .unspecified,
            1 => .stream,
            2 => .dgram,
            else => return error.InvalidSocketType,
        };
    }

    if (value.isString()) {
        return try SocketType.map.fromJS(globalObject, value) orelse {
            if ((try value.toJSString(globalObject)).length() == 0)
                return .unspecified;

            return error.InvalidSocketType;
        };
    }

    return error.InvalidSocketType;
}
pub fn protocolFromJS(value: jsc.JSValue, globalObject: *jsc.JSGlobalObject) FromJSError!Protocol {
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
        return try Protocol.map.fromJS(globalObject, value) orelse {
            const str = try value.toJSString(globalObject);
            if (str.length() == 0)
                return .unspecified;

            return error.InvalidProtocol;
        };
    }

    return error.InvalidProtocol;
}
pub fn backendFromJS(value: jsc.JSValue, globalObject: *jsc.JSGlobalObject) Backend.FromJSError!Backend {
    if (value.isEmptyOrUndefinedOrNull())
        return Backend.default;

    if (value.isString()) {
        return try Backend.label.fromJS(globalObject, value) orelse {
            if ((try value.toJSString(globalObject)).length() == 0) {
                return Backend.default;
            }

            return error.InvalidBackend;
        };
    }

    return error.InvalidBackend;
}
pub fn resultAnyToJS(this: *const Result.Any, globalThis: *jsc.JSGlobalObject) bun.JSError!?jsc.JSValue {
    return switch (this.*) {
        .addrinfo => |addrinfo| try addrInfoToJSArray(addrinfo orelse return null, globalThis),
        .list => |list| brk: {
            const array = try jsc.JSValue.createEmptyArray(globalThis, @as(u32, @truncate(list.items.len)));
            var i: u32 = 0;
            const items: []const Result = list.items;
            for (items) |item| {
                try array.putIndex(globalThis, i, try item.toJS(globalThis));
                i += 1;
            }
            break :brk array;
        },
    };
}
pub fn resultToJS(this: *const Result, globalThis: *jsc.JSGlobalObject) bun.JSError!JSValue {
    const obj = jsc.JSValue.createEmptyObject(globalThis, 3);
    obj.put(globalThis, jsc.ZigString.static("address"), try addressToJS(&this.address, globalThis));
    obj.put(globalThis, jsc.ZigString.static("family"), switch (this.address.any.family) {
        std.posix.AF.INET => JSValue.jsNumber(4),
        std.posix.AF.INET6 => JSValue.jsNumber(6),
        else => JSValue.jsNumber(0),
    });
    obj.put(globalThis, jsc.ZigString.static("ttl"), JSValue.jsNumber(this.ttl));
    return obj;
}
pub fn addressToJS(address: *const std.net.Address, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    var str = addressToString(address) catch return globalThis.throwOutOfMemory();
    return str.transferToJS(globalThis);
}
pub fn addrInfoToJSArray(addr_info: *std.c.addrinfo, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    const array = try jsc.JSValue.createEmptyArray(
        globalThis,
        addrInfoCount(addr_info),
    );

    {
        var j: u32 = 0;
        var current: ?*std.c.addrinfo = addr_info;
        while (current) |this_node| : (current = current.?.next) {
            try array.putIndex(
                globalThis,
                j,
                try GetAddrInfo.Result.toJS(
                    &(GetAddrInfo.Result.fromAddrInfo(this_node) orelse continue),
                    globalThis,
                ),
            );
            j += 1;
        }
    }

    return array;
}

const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;

const addrInfoCount = bun.dns.addrInfoCount;
const addressToString = bun.dns.addressToString;

const GetAddrInfo = bun.dns.GetAddrInfo;
const Backend = GetAddrInfo.Backend;
const Family = GetAddrInfo.Family;
const Protocol = GetAddrInfo.Protocol;
const Result = GetAddrInfo.Result;
const SocketType = GetAddrInfo.SocketType;

const Options = GetAddrInfo.Options;
const FromJSError = Options.FromJSError;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
