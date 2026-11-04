import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
delete [0].flatMap(() => [types])[0].isDate;
console.log(typeof types.isDate, tell(() => types.isDate(1)));
