const { Readable } = require("node:stream");
const nothing = () => {};
const seen = [];
function watch(holder) {
  let kept;
  Object.defineProperty(holder, "_readableState", {
    get() { seen.push("read"); return kept; },
    set(value) { seen.push("stored"); kept = value; },
    configurable: true,
  });
}
function listen(spring) {
  const before = seen.length;
  spring.on("error", nothing);
  spring.removeListener("error", nothing);
  spring.on("close", nothing);
  return `${seen.length - before}:${spring.listenerCount("error")}${spring.listenerCount("close")}`;
}
let Kept;
let depth = 0;
const made = [];
function base() {
  if (!depth++) made.push(keptClass());
  return Readable;
}
function keptClass() {
  if (Kept) return Kept;
  Kept = class Spring extends base() {
    level = 0;
    _read() {}
  };
  return Kept;
}
made.push(keptClass());
watch(made[0].prototype);
console.log(made[0] === made[1], listen(new made[0]()), listen(new made[1]()), seen.join(" "));
