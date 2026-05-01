pub fn createBinding(globalObject: *jsc.JSGlobalObject) JSValue {
    const binding = JSValue.createEmptyObjectWithNullPrototype(globalObject);
    binding.put(globalObject, ZigString.static("MySQLConnection"), MySQLConnection.js.getConstructor(globalObject));
    binding.put(globalObject, ZigString.static("init"), jsc.JSFunction.create(globalObject, "init", MySQLContext.init, 0, .{}));
    binding.put(
        globalObject,
        ZigString.static("createQuery"),
        jsc.JSFunction.create(globalObject, "createQuery", MySQLQuery.createInstance, 6, .{}),
    );

    binding.put(
        globalObject,
        ZigString.static("createConnection"),
        jsc.JSFunction.create(globalObject, "createConnection", MySQLConnection.createInstance, 2, .{}),
    );

    return binding;
}

pub const MySQLConnection = @import("./mysql/js/JSMySQLConnection.zig");
pub const MySQLContext = @import("./mysql/MySQLContext.zig");
pub const MySQLQuery = @import("./mysql/js/JSMySQLQuery.zig");

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
