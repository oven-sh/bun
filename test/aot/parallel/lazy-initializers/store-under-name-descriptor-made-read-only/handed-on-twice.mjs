function set(f) {
  f.k = 2;
}
function through(f) {
  set(f);
}
function make() {
  const f = function () {};
  Object.defineProperty(f, "k", { value: 1 });
  through(f);
  return f;
}
const held = make();
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
