pub fn createBinding(globalObject: *jsc.JSGlobalObject) JSValue {
    const binding = JSValue.createEmptyObjectWithNullPrototype(globalObject);
    binding.put(globalObject, ZigString.static("PostgresSQLConnection"), PostgresSQLConnection.js.getConstructor(globalObject));
    binding.put(globalObject, ZigString.static("init"), jsc.JSFunction.create(globalObject, "init", PostgresSQLContext.init, 0, .{}));
    binding.put(
        globalObject,
        ZigString.static("createQuery"),
        jsc.JSFunction.create(globalObject, "createQuery", PostgresSQLQuery.call, 6, .{}),
    );

    binding.put(
        globalObject,
        ZigString.static("createConnection"),
        jsc.JSFunction.create(globalObject, "createConnection", PostgresSQLConnection.call, 2, .{}),
    );

    return binding;
}

pub const PostgresSQLConnection = @import("./postgres/PostgresSQLConnection.zig");
pub const PostgresSQLContext = @import("./postgres/PostgresSQLContext.zig");
pub const PostgresSQLQuery = @import("./postgres/PostgresSQLQuery.zig");
pub const protocol = @import("./postgres/PostgresProtocol.zig");
pub const types = @import("./postgres/PostgresTypes.zig");

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
