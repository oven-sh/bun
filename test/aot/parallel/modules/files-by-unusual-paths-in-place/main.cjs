// An executable that runs in place finds its files by paths with unusual characters.
// Flags: --compile-in-place
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const path = require("node:path");
const written = [
  require("./files/plain.cjs"),
  require("./files/with space.cjs"),
  require("./files/with%percent.cjs"),
  require("./files/with%41escape.cjs"),
  require("./files/ünïcode.cjs"),
  require("./files/日本語.cjs"),
  require("./files/a.cjs"),
  require("./files/a.b.cjs"),
  require("./files/a-b.cjs"),
  require("./files/ab.cjs"),
  require("./files/nested/a.cjs"),
  require("./files/nested.cjs"),
];
const names = [
  "plain.cjs",
  "with space.cjs",
  "with%percent.cjs",
  "with%41escape.cjs",
  "ünïcode.cjs",
  "日本語.cjs",
  "a.cjs",
  "a.b.cjs",
  "a-b.cjs",
  "ab.cjs",
  "nested/a.cjs",
  "nested.cjs",
];
const computed = names.map(name => require(path.join(__dirname, "files", name)));
const missing = ["files/absent.cjs", "files/a", "files/a.c", "files/with", "files/zzz.cjs"].map(name => {
  try {
    return require(path.join(__dirname, name));
  } catch (error) {
    return error.code;
  }
});
console.log(JSON.stringify({ written, computed, missing }));
