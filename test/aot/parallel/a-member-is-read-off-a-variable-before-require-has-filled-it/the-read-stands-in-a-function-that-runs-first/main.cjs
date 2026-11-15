process.on("uncaughtException", error => console.log(error.constructor.name));
console.log("start");
function early() {
  shapes.area;
  return "read";
}
console.log(early());
var shapes = require("./shapes.mjs");
console.log("end", shapes.area(), early());
