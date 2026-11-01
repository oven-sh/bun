// Alone: the stores of other programs would be seen beside its own
import buffer from "node:buffer";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
};
console.log(typeof buffer.constants.MAX_LENGTH);
new Function(
  JSON.parse(JSON.stringify('process.getBuiltinModule("node:buffer").constants = { MAX_LENGTH: "mine" };')),
)();
console.log(
  tell(() => typeof buffer.constants.MAX_LENGTH),
  tell(() => typeof buffer.constants),
);
