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
function keptClass() {
  if (Kept) return Kept;
  Kept = class Spring extends Readable {
    level = 0;
    _read() {}
  };
  return Kept;
}
function quiet(turns) {
  const said = new Set();
  for (let turn = 0; turn < turns; turn++) said.add(listen(new (keptClass())()));
  return [...said].join(" ");
}
console.log(quiet(40));
watch(keptClass().prototype);
console.log(quiet(3), seen.length > 0);
