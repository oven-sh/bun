// Alone: the stores of other programs would be seen beside its own
let e;
try {
  null.x;
} catch (x) {
  e = x;
}
TypeError[1] = [1, 2];
Object.defineProperty(e.constructor, 1, {
  get() {
    return { length: 3 };
  },
});
function read() {
  return TypeError[1].length;
}
console.log(read());
