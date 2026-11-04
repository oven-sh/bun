let e;
try {
  null.x;
} catch (x) {
  e = x;
}
Object.defineProperty(e.constructor, 1, {
  get() {
    return 0;
  },
});
function read() {
  return TypeError[1];
}
console.log(read());
