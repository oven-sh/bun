import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
Object.setPrototypeOf(new Error("e", { cause: types }).cause, { above: "mine" });
console.log(tell(() => types.above), tell(() => Object.getPrototypeOf(types).above));
