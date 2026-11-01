// Alone: the stores of other programs would be seen beside its own
let e;
try {
  null.x;
} catch (x) {
  e = x;
}
e.constructor[1] = 9;
function read() {
  return TypeError[1];
}
console.log(read());
