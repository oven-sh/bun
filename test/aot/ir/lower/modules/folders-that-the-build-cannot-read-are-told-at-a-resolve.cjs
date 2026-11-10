// DIAGNOSTIC: TS100095 main.cjs:7
// DIAGNOSTIC: TS100095 main.cjs:9
// DIAGNOSTIC: TS100095 main.cjs:10
// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/main.cjs"

// FILE: main.cjs
// A list that a function changes, options that a name holds and a folder that only the run knows are not read. No options, options without `paths` and a list that is written out say nothing.
const { join } = require("node:path");
const second = join(__dirname, "second");
const paths = [__dirname];
(list => list.unshift(second))(paths);
const options = { paths: [second] };
console.log(require.resolve("./part.cjs", { paths }));
console.log(require.resolve("./part.cjs"), require.resolve("./part.cjs", {}), require.resolve("./part.cjs", undefined));
console.log(require.resolve("./part.cjs", options));
console.log(require.resolve("./part.cjs", { paths: [process.cwd()] }));
console.log(require.resolve("./part.cjs", { paths: [second, __dirname] }));

// FILE: part.cjs
exports.name = "first";

// FILE: second/part.cjs
exports.name = "second";
