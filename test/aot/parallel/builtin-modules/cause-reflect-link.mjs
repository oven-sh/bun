import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
Reflect.setPrototypeOf(new Error("e", { cause: types }).cause, { extra: () => "mine" });
console.log(typeof types.extra, tell(() => types.extra()));
