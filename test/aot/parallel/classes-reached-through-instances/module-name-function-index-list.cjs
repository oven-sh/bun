// Alone: the stores of other programs would be seen beside its own
const other = require("node:buffer").atob;
atob[1] = [1, 2];
other[1] = { length: 3 };
function read() {
  return atob[1].length;
}
console.log(read());
