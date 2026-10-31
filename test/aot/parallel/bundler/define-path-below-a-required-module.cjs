// A `--define` whose value is a dotted path calls a member of the variable that holds what `require("node:fs")` returned.
// Flags: --define READ=fs.existsSync
const fs = require("node:fs");
console.log(typeof fs.statSync, READ("/"));
