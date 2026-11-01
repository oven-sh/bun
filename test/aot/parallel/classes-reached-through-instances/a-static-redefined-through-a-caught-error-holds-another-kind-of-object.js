TypeError.list = [1, 2];
try {
  null.x;
} catch (e) {
  Object.defineProperty(e.constructor, "list", { value: { length: 3 }, writable: false });
}
function read() {
  return TypeError.list.length;
}
console.log(read());
