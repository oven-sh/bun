// Alone: the stores of other programs would be seen beside its own
// One function under two names: what is stored on it by the module's name is read by the global's.
import buffer from "node:buffer";
function read() {
  return btoa.kept;
}
Object.assign(buffer.btoa, { kept: 7 });
console.log(read() + "");
