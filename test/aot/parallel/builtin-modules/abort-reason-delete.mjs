import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
delete AbortSignal.abort(types).reason.isDate;
console.log(typeof types.isDate, tell(() => types.isDate(1)));
