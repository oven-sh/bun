try {
  null.x;
} catch (e) {
  e.constructor.extra = 41;
}
function read() {
  return TypeError.extra;
}
console.log(read());
