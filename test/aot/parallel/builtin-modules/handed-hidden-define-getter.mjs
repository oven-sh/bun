import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const load = JSON.parse("0", () => process.getBuiltinModule);
JSON.parse("0", () => Object.defineProperty)(load("node:util/types"), "isDate", { get() { return () => "mine"; }, configurable: true });
console.log(tell(() => types.isDate(1)));
