class Mine extends TypeError {}
try {
  null.x;
} catch (e) {
  e.constructor.extra = 41;
}
function read() {
  return Mine.extra;
}
console.log(read());
