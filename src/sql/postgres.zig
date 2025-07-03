pub fn createBinding(globalObject: *JSC.JSGlobalObject) JSValue {
    const binding = JSValue.createEmptyObjectWithNullPrototype(globalObject);
    binding.put(globalObject, ZigString.static("PostgresSQLConnection"), PostgresSQLConnection.js.getConstructor(globalObject));
    binding.put(globalObject, ZigString.static("init"), JSC.JSFunction.create(globalObject, "init", PostgresSQLContext.init, 0, .{}));
    binding.put(
        globalObject,
        ZigString.static("createQuery"),
        JSC.JSFunction.create(globalObject, "createQuery", PostgresSQLQuery.call, 6, .{}),
    );

    binding.put(
        globalObject,
        ZigString.static("createConnection"),
        JSC.JSFunction.create(globalObject, "createQuery", PostgresSQLConnection.call, 2, .{}),
    );

    return binding;
}

const assert = bun.assert;
const bun = @import("bun");
const JSC = bun.JSC;
const String = bun.String;
const uws = bun.uws;
const Socket = uws.AnySocket;
const std = @import("std");
const debug = bun.Output.scoped(.Postgres, false);

const JSValue = JSC.JSValue;
const BoringSSL = bun.BoringSSL;
const ZigString = JSC.ZigString;

pub const types = @import("./postgres/PostgresTypes.zig");

const int4 = types.int4;
const short = types.short;
const int8 = types.int8;
const PostgresInt32 = types.PostgresInt32;
const PostgresInt64 = type s.PostgresInt64;
const PostgresShort = types.PostgresShort;
pub const protocol = @import("./postgres/PostgresProtocol.zig");
const PostgresSQLConnection = @import("./postgres/PostgresSQLConnection.zig");
const PostgresRequest = @import("./postgres/PostgresRequest.zig");
const SSLMode = @import("./postgres/SSLMode.zig").SSLMode;
const Data = @import("./postgres/Data.zig").Data;
const PostgresSQLQuery = @import("./postgres/PostgresSQLQuery.zig");
const PostgresSQLContext = @import("./postgres/PostgresSQLContext.zig");