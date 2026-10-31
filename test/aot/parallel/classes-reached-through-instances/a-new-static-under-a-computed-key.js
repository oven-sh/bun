const key = ["ex", "tra"].join("");
try {
  null.x;
} catch (e) {
  e.constructor[key] = 41;
}
function read() {
  return TypeError.extra;
}
console.log(read());
