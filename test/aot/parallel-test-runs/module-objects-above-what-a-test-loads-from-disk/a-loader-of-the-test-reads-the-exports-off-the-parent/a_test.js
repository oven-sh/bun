// The test lays a loader for files of data. What the loader is handed has the compiled file that asked for its parent.
const { test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const asks = require("./asks.cjs");
test("t", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "comes-later-"));
  fs.writeFileSync(path.join(folder, "late.json"), "{}");
  const former = require.extensions[".json"];
  require.extensions[".json"] = function load(made) {
    made.exports = [path.basename(made.parent.id), Object.keys(made.parent.exports).join("+"), made.parent.exports === asks, made.parent.exports.sum("a", "b")].join(" ");
  };
  console.log(asks.sum(1, 2), asks.load(path.join(folder, "late.json")));
  require.extensions[".json"] = former;
  fs.rmSync(folder, { recursive: true });
});
