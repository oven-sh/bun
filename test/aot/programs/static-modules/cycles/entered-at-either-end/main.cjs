// The same cycle of three modules twice. The first copy is entered at x by a require at the top. The second is entered at z, by a require in a function that runs before the require of x at the top: which module is found half done is decided by who comes first at run time.
const log = require("./log.cjs");
function loadLast() {
  return require("./second/z.cjs");
}
require("./first/x.cjs");
log.push("--");
loadLast();
require("./second/x.cjs");
console.log(log.join("\n"));
