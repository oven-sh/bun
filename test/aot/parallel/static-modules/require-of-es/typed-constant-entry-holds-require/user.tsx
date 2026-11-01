const ns: { f: typeof import("./m.js").f } = require("./m.js");
export function run() {
  return ns.f();
}
