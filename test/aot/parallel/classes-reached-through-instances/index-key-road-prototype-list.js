let e;
try {
  null.x;
} catch (x) {
  e = x;
}
TypeError.prototype[1] = [1, 2];
e.constructor.prototype[1] = { length: 3 };
function read() {
  return TypeError.prototype[1].length;
}
console.log(read());
