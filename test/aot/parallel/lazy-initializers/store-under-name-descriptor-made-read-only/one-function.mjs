function make() {
  const f = function () {};
  Object.defineProperty(f, "k", { value: 1 });
  f.k = 2;
  return f;
}
const held = make();
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
