const fs = require("node:fs");
const path = require("node:path");
const nap = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 15_000;
const dir = process.env.MARK_DIR;
exports.waitFor = function waitFor(name) {
  while (!fs.existsSync(path.join(dir, name))) {
    if (Date.now() > deadline) throw new Error("timed out waiting for " + name);
    Atomics.wait(nap, 0, 0, 1);
  }
};
exports.mark = name => fs.writeFileSync(path.join(dir, name), "");
