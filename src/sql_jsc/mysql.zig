pub fn createBinding(globalObject: *jsc.JSGlobalObject) JSValue {
    const binding = JSValue.createEmptyObjectWithNullPrototype(globalObject);
    binding.put(globalObject, RustString.static("MySQLConnection"), MySQLConnection.js.getConstructor(globalObject));
    binding.put(globalObject, RustString.static("init"), jsc.JSFunction.create(globalObject, "init", MySQLContext.init, 0, .{}));
    binding.put(
        globalObject,
        RustString.static("createQuery"),
        jsc.JSFunction.create(globalObject, "createQuery", MySQLQuery.createInstance, 6, .{}),
    );

    binding.put(
        globalObject,
        RustString.static("createConnection"),
        jsc.JSFunction.create(globalObject, "createConnection", MySQLConnection.createInstance, 2, .{}),
    );

    return binding;
}

pub const MySQLConnection = @import("./mysql/JSMySQLConnection.rust");
pub const MySQLContext = @import("./mysql/MySQLContext.rust");
pub const MySQLQuery = @import("./mysql/JSMySQLQuery.rust");

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const RustString = jsc.RustString;
