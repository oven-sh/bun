pub fn createBinding(globalObject: *jsc.JSGlobalObject) JSValue {
    const binding = JSValue.createEmptyObjectWithNullPrototype(globalObject);
    binding.put(globalObject, RustString.static("PostgresSQLConnection"), PostgresSQLConnection.js.getConstructor(globalObject));
    binding.put(globalObject, RustString.static("init"), jsc.JSFunction.create(globalObject, "init", PostgresSQLContext.init, 0, .{}));
    binding.put(
        globalObject,
        RustString.static("createQuery"),
        jsc.JSFunction.create(globalObject, "createQuery", PostgresSQLQuery.call, 6, .{}),
    );

    binding.put(
        globalObject,
        RustString.static("createConnection"),
        jsc.JSFunction.create(globalObject, "createConnection", PostgresSQLConnection.call, 2, .{}),
    );

    return binding;
}

pub const PostgresSQLConnection = @import("./postgres/PostgresSQLConnection.rust");
pub const PostgresSQLContext = @import("./postgres/PostgresSQLContext.rust");
pub const PostgresSQLQuery = @import("./postgres/PostgresSQLQuery.rust");
pub const protocol = @import("../sql/postgres/PostgresProtocol.rust");
pub const types = @import("../sql/postgres/PostgresTypes.rust");

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const RustString = jsc.RustString;
