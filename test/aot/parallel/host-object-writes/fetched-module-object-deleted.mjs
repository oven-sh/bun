// Alone: the stores of other programs would be seen beside its own
import buffer from "node:buffer";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
};
new Function(JSON.parse(JSON.stringify('delete process.getBuiltinModule("node:buffer").constants;')))();
console.log(
  tell(() => typeof buffer.constants.MAX_LENGTH),
  tell(() => typeof buffer.constants),
);
