// Alone: the stores of other programs would be seen beside its own
import os from "node:os";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name + " " + error.code;
  }
};
const hidden = JSON.parse("0", () => process.getBuiltinModule);
Object.defineProperty(hidden("node:os"), "EOL", { get: () => "mine", configurable: true });
console.log(
  JSON.stringify(os.EOL),
  tell(() => os.platform() === process.platform),
);
