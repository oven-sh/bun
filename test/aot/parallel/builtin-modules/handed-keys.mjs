import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const load = JSON.parse("0", () => process.getBuiltinModule);
load("node:util/types").nope = 1;
console.log(Object.keys(types).includes("nope"), "nope" in types);
