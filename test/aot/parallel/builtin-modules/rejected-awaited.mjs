import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
try {
  await Promise.reject(types);
} catch (held) {
  Object.setPrototypeOf(held, { extra: () => "mine" });
}
console.log(typeof types.extra, tell(() => types.extra()));
