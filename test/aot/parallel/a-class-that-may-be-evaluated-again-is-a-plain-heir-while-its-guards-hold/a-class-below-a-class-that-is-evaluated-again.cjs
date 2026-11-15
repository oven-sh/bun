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
function make() {
  return class Spring extends Readable {
    level = 0;
    _read() {}
  };
}
const First = make();
class Brook extends First {
  width = 1;
}
console.log(listen(new Brook()));
const Second = make();
watch(Second.prototype);
console.log(listen(new Brook()), listen(new Second()), seen.join(" "));
watch(First.prototype);
console.log(listen(new Brook()), seen.length);
