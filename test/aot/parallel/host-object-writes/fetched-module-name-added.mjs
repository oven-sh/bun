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
hidden("node:path").added = 5;
console.log(path.added, Object.keys(path).includes("added"));
