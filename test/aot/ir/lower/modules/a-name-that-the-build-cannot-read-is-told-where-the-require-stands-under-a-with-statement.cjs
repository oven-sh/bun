// DIAGNOSTIC: TS100094 main.cjs:4
// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/main.cjs"

// FILE: main.cjs
// Under `with` every name is looked up at the run: neither `uses` nor `name` can be read.
const uses = { a: "./part.cjs" };
with ({ quiet: 1 }) {
  for (const name in uses) console.log(require(uses[name]).value);
}

// FILE: part.cjs
exports.value = "part";
