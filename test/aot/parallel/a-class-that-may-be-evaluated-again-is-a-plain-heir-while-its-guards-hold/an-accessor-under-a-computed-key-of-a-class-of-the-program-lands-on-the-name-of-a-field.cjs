const { Readable } = require("node:stream");
const nothing = () => {};
const seen = [];
const name = ["_readableState", "elsewhere"][process.argv.length > 99 ? 1 : 0];
let kept;
function listen(spring) {
  const before = seen.length;
  spring.on("error", nothing);
  spring.removeListener("error", nothing);
  spring.on("close", nothing);
  return `${seen.length - before}:${spring.listenerCount("error")}${spring.listenerCount("close")}`;
}
class Spring extends Readable {
  _read() {}
  get [name]() { seen.push("read"); return kept; }
  set [name](value) { seen.push("stored"); kept = value; }
}
console.log(listen(new Spring()), listen(new Spring()), seen.length > 0);
