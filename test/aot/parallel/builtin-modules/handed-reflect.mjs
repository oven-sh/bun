import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const load = JSON.parse("0", () => process.getBuiltinModule);
JSON.parse("0", () => Reflect.deleteProperty)(load("node:util/types"), "isDate");
console.log(typeof types.isDate);
