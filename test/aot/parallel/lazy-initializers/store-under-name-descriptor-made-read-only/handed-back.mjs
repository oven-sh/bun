function locked() {
  const f = function () {};
  Object.defineProperty(f, "k", { value: 1 });
  return f;
}
function make() {
  const f = locked();
  f.k = 2;
  return f;
}
const held = make();
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
