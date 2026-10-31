function make() {
  const f = function () {};
  Object.defineProperty(f, "name", { value: "a" });
  return f;
}
const held = make();
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
