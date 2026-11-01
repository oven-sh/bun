// Alone: the stores of other programs would be seen beside its own
let e;
try {
  null.x;
} catch (x) {
  e = x;
}
e.constructor.prototype[1] = 9;
function read(i) {
  return new TypeError("m")[i];
}
console.log(read(1));
