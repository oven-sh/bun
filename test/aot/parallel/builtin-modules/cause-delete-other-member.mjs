import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
delete new Error("e", { cause: types }).cause.isRegExp;
console.log(typeof types.isRegExp, tell(() => types.isRegExp(1)), tell(() => types.isDate(1)));
