class Mine extends TypeError {}
const key = ["ex", "tra"].join("");
try {
  null.x;
} catch (e) {
  e.constructor[key] = 41;
}
function read() {
  return Mine.extra;
}
console.log(read());
