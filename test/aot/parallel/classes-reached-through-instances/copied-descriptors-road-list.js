// Alone: the stores of other programs would be seen beside its own
function make() {
  return { list: { length: 3 } };
}
TypeError.list = [1, 2];
let e;
try {
  null.x;
} catch (x) {
  e = x;
}
Object.defineProperties(e.constructor, Object.getOwnPropertyDescriptors(make()));
function read() {
  return TypeError.list.length;
}
console.log(read());
