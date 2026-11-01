// Alone: the stores of other programs would be seen beside its own
import * as lib from "node:stream/web";
WritableStream.prototype.getWriter.list = [1, 2];
lib.WritableStream.prototype.getWriter.list = { length: 3 };
function read() {
  return WritableStream.prototype.getWriter.list.length;
}
console.log(read());
