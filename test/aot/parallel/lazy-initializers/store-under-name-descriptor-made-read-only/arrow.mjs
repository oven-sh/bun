function set(f) {
  f.label = "b";
}
function make() {
  const f = () => 1;
  Object.defineProperty(f, "label", { value: "a", enumerable: true, configurable: true });
  set(f);
  return f;
}
const held = make();
function read() {
  return held;
}
if (process.argv.length > 100) console.log(read());
