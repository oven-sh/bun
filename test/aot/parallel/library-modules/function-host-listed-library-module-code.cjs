// Each line: a frame of a stack that is taken while library modules load for the first time, without the two frames inside internal/primordials and without the places inside library modules.
const seen = [];
const custom = Symbol.for("nodejs.util.inspect.custom");
Object.defineProperty(Map.prototype, custom, {
  configurable: true,
  value() {
    seen[seen.length] = new Error("at").stack;
    return "inspected";
  },
});
function load() {
  const util = require("node:util");
  return util;
}
load();
delete Map.prototype[custom];
console.log(seen.length);
for (const stack of seen) {
  const frames = stack.split("\n").slice(1);
  console.log(
    frames
      .filter(frame => !frame.includes("primordials") && !frame.includes("WithoutParameters"))
      .map(frame => frame.trim().replace(/[^ ()]*[\/\\]([\w.-]+:\d+:\d+)/, "$1"))
      .map(frame => frame.replace(/\((node|internal):([^:)]+):\d+:\d+\)/, "($1:$2)"))
      .join(" < "),
  );
}
