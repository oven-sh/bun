// Alone: the stores of other programs would be seen beside its own
import path from "node:path";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name + " " + error.code;
  }
};
const hidden = JSON.parse("0", () => process.getBuiltinModule);
console.log(
  path.join("a", "b"),
  tell(() => hidden("node:path").join(1)),
  tell(() => hidden("node:path").join({}, "x")),
  tell(() => hidden("node:path").basename(7)),
);
