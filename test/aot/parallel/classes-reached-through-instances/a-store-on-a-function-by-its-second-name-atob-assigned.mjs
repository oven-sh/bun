// Alone: the stores of other programs would be seen beside its own
// One function under two names: what is stored on it by the module's name is read by the global's.
import buffer from "node:buffer";
function read() {
  return atob.kept;
}
Object.assign(buffer.atob, { kept: 7 });
console.log(read() + "");
