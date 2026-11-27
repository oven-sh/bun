// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/part.cjs"

// FILE: main.cjs
// The name is looked up at the run: it may be the file's own require, so the file is brought, and the call is left as it is written.
const scope = { quiet: 1 };
with (scope) {
  console.log(require("./part.cjs").value);
}

// FILE: part.cjs
exports.value = "part";
