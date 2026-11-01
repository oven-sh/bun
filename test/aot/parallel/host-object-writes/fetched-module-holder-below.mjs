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
hidden("node:path").posix.basename = () => "mine";
console.log(path.posix.basename("/a/b"), path.basename("/a/b"));
