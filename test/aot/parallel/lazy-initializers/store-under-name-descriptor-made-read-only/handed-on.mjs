function set(f) {
  f.k = 2;
}
function make() {
  const f = function () {};
  Object.defineProperty(f, "k", { value: 1 });
  set(f);
  return f;
}
const held = make();
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
