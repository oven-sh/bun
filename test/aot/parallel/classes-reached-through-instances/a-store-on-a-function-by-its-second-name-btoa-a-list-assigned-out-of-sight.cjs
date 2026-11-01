// Alone: the stores of other programs would be seen beside its own
// One function under two names: what is stored on it by the module's name is read by the global's.
const other = require("node:buffer").btoa;
function read() {
  return btoa.kept.length;
}
JSON.parse("0", () => Object.assign)(other, { kept: [1, 2, 3] });
console.log(read() + "");
