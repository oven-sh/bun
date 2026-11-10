// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/second/part.cjs"

// FILE: main.cjs
// The name is looked for from each listed folder in its turn, so what `second` answers is in the executable too, not only what the file's own folder answers.
const { join } = require("node:path");
const second = join(__dirname, "second");
console.log(require.resolve("./part.cjs", { paths: [second, __dirname] }));

// FILE: part.cjs
exports.name = "first";

// FILE: second/part.cjs
exports.name = "second";
