function early() {
  return path.sep;
}
try {
  early();
} catch (error) {
  console.log(error.name);
}
const path = require("node:path");
console.log(early());
