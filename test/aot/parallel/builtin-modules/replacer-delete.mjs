import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
JSON.stringify({ a: 1, p: types }, function (key, value) {
  if (key === "a") delete this.p.isDate;
  return key === "p" ? undefined : value;
});
console.log(typeof types.isDate, tell(() => types.isDate(new Date(0))));
