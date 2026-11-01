// Alone: the stores of other programs would be seen beside its own
// One function under two names: what is stored on it by the module's name is read by the global's.
import { atob as other } from "node:buffer";
function read() {
  return atob.kept;
}
JSON.parse("0", () => Reflect.set)(other, "kept", 7);
console.log(read() + "");
