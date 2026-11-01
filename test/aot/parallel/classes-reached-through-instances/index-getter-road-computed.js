// Alone: the stores of other programs would be seen beside its own
let e;
try {
  null.x;
} catch (x) {
  e = x;
}
Object.defineProperty(e.constructor, JSON.parse("1"), {
  get() {
    return 7;
  },
});
function read() {
  return TypeError[1];
}
console.log(read());
