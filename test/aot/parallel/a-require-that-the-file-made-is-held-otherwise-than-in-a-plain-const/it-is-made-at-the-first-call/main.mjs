let held;
function load(name) {
  held ??= process.getBuiltinModule("module").createRequire(import.meta.url);
  return held("./lib/part.cjs");
}
let kept;
const get = () => (kept ||= process.getBuiltinModule("module").createRequire(import.meta.url));
console.log("SAID", load(), load(), get()("./lib/index.cjs"), get() === get());
