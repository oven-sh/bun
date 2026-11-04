import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
new Error("e", { cause: types }).cause.__proto__ = { extra: () => "mine" };
console.log(typeof types.extra, tell(() => types.extra()));
