// `bun run` runs the text of this file once more, into the object that was made. The executable holds the file once, compiled, and refuses: each time it is asked, and the object stays as it was made.
exports.count = 1;
if (!globalThis.ranBefore) {
  globalThis.ranBefore = true;
  const Module = require("node:module");
  const made = new Module("made");
  for (let turn = 0; turn < 2; turn++) {
    let outcome = "loaded";
    try {
      Module._extensions[".js"](made, Bun.main);
    } catch (error) {
      outcome = error.message.replace(/'.*?'/, "<path>").split(":")[0];
    }
    console.log(outcome, made.exports === exports, Object.keys(made.exports).length);
  }
}
console.log(exports.count);
/* Output:
Cannot run <path> a second time false 0
Cannot run <path> a second time false 0
1
*/
