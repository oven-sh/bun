// `bun run` runs the text of this file once more, into the object that was made. The executable holds the file once, compiled. It handed out the exports of the one that runs; now it refuses, as an executable of `bun build --compile` does. The expected output is written down.
exports.count = 1;
exports.label = "entry";
if (!globalThis.ranBefore) {
  globalThis.ranBefore = true;
  const Module = require("node:module");
  for (const prepare of [() => new Module("made"), () => Object.assign(new Module("made"), { loaded: false })]) {
    const made = prepare();
    let outcome = "loaded";
    try {
      Module._extensions[".js"](made, Bun.main);
    } catch (error) {
      outcome = error.message.replace(/'.*?'/, "<path>").split(":")[0];
    }
    made.exports.count = 2;
    made.exports.label = 7;
    console.log(outcome, made.exports === exports);
  }
}
console.log(exports.count, exports.label.length);
/* Output:
Cannot run <path> a second time false
Cannot run <path> a second time false
1 5
*/
