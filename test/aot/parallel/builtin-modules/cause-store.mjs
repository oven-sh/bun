import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
new Error("e", { cause: types }).cause.isDate = () => "mine";
console.log(typeof types.isDate, tell(() => types.isDate(new Date(0))));
