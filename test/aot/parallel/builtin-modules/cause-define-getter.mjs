import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
Object.defineProperty(new Error("e", { cause: types }).cause, "isDate", { get() { return () => "mine"; }, configurable: true });
console.log(typeof types.isDate, tell(() => types.isDate(new Date(0))));
