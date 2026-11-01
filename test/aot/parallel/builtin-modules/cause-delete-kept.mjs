import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
delete new Error("e", { cause: types }).cause.isDate;
const kept = types.isDate;
console.log(typeof kept, tell(() => kept(1)), tell(() => types.isDate.name));
