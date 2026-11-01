// Alone: the stores of other programs would be seen beside its own
const other = require("node:buffer").atob;
try {
  other.toString = () => "mine";
} catch (x) {
  console.log("refused");
}
function read() {
  return atob.toString();
}
console.log(read());
