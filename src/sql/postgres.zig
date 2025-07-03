// @sortImports

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

const bun = @import("bun");
const JSC = bun.JSC;

const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;

pub const types = @import("./postgres/PostgresTypes.zig");

pub const protocol = @import("./postgres/PostgresProtocol.zig");

pub const PostgresSQLQuery = @import("./postgres/PostgresSQLQuery.zig");
pub const PostgresSQLContext = @import("./postgres/PostgresSQLContext.zig");
pub const PostgresSQLConnection = @import("./postgres/PostgresSQLConnection.zig");
