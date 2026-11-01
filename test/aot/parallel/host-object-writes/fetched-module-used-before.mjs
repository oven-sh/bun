// Alone: the stores of other programs would be seen beside its own
import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name + " " + error.code;
  }
};
const hidden = JSON.parse("0", () => process.getBuiltinModule);
const before = types.isDate(new Date(0));
hidden("node:util/types").isDate = () => "mine";
console.log(before, types.isDate(1));
