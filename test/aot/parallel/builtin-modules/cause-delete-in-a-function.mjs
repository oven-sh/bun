import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
function drop(holder) {
  delete holder.cause.isDate;
}
drop(new Error("e", { cause: types }));
console.log(typeof types.isDate, tell(() => types.isDate(new Date(0))));
