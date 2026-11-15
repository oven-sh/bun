// In an executable `delete require.cache[path]` does nothing: a declared difference from `bun <file>`. What it leaves is one rule for both spellings:
// behind a delete, require() under a path made at run time answers in the same way as require() under a written path. It answered the bare value whatever had gone before.
import one from "./made.json" with { type: "json" };
import two from "./written.json" with { type: "json" };
const kind = it => (it.default === undefined ? "the value" : "the namespace");
delete require.cache[require.resolve("./made.json")];
delete require.cache[require.resolve("./written.json")];
console.log(typeof one, typeof two, kind(require(process.argv[2] ?? "./made.json")) === kind(require("./written.json")));
