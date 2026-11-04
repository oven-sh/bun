import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
delete JSON.parse("0", () => types).isDate;
console.log(typeof types.isDate, tell(() => types.isDate(new Date(0))));
