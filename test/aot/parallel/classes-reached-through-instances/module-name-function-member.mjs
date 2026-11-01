// Alone: the stores of other programs would be seen beside its own
import { atob as other } from "node:buffer";
other.seen = () => "other";
function read() {
  return atob.seen.call(null);
}
console.log(read());
