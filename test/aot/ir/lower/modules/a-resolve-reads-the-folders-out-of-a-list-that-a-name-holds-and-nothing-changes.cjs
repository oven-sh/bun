// DIAGNOSTIC: TS100095 main.cjs:7
// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/second/part.cjs"
// CHECK-NOT: path="/$bunfs/root/third/part.cjs"

// FILE: main.cjs
// `paths` is only read by the resolver, so the list is as it is written. `changed` is pushed to: it is not read, nothing is brought for it, and the build says so.
const { join } = require("node:path");
const paths = [join(__dirname, "second"), __dirname];
console.log(require.resolve("./part.cjs", { paths }));
const changed = [];
changed.push(join(__dirname, "third"));
console.log(require.resolve("./part.cjs", { paths: changed }));

// FILE: part.cjs
exports.name = "first";

// FILE: second/part.cjs
exports.name = "second";

// FILE: third/part.cjs
exports.name = "third";
