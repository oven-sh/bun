// Alone: the stores of other programs would be seen beside its own
import buffer from "node:buffer";
import types from "node:util/types";
import path from "node:path";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
};
const text = JSON.parse(
  JSON.stringify(
    'process.getBuiltinModule("node:buffer").atob = () => "mine"; process.getBuiltinModule("node:util/types").isDate = () => "mine"; process.getBuiltinModule("node:path").basename = () => "mine";',
  ),
);
tell(() => (0, eval)(text));
console.log(
  tell(() => buffer.atob("YQ==")),
  tell(() => types.isDate(1)),
  tell(() => path.basename("/a/b")),
);
