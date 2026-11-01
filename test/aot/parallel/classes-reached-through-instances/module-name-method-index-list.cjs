// Alone: the stores of other programs would be seen beside its own
const Other = require("node:stream/web").WritableStream;
WritableStream.prototype.getWriter[1] = [1, 2];
Other.prototype.getWriter[1] = { length: 3 };
function read() {
  return WritableStream.prototype.getWriter[1].length;
}
console.log(read());
