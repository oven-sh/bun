// Alone: the stores of other programs would be seen beside its own
let e;
try {
  null.x;
} catch (x) {
  e = x;
}
TypeError.list = [1, 2];
JSON.parse("0", () => Object.defineProperty)(e.constructor, "list", { value: { length: 3 } });
function read() {
  return TypeError.list.length;
}
console.log(read());
