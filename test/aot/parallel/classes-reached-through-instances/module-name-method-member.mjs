// Alone: the stores of other programs would be seen beside its own
import { WritableStream as Other } from "node:stream/web";
Other.prototype.getWriter.value = 1.5;
function read() {
  return WritableStream.prototype.getWriter.value;
}
console.log(read());
