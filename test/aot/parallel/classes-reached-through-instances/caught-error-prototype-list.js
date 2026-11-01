// Alone: the stores of other programs would be seen beside its own
TypeError.prototype.list = [1, 2];
function put(where, what) {
  where.list = what;
}
try {
  null.x;
} catch (e) {
  put(e.constructor.prototype, { length: 3 });
}
function read() {
  return TypeError.prototype.list.length;
}
console.log(read());
