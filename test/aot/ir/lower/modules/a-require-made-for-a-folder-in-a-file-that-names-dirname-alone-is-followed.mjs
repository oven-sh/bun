// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/lib/part.js"
// CHECK: EvaluateModule {{*}}[isCallOfRequire]

// FILE: main.mjs
// The file names `__dirname` and nothing else that a require or a path of the file comes from: the folder that the require looks from is
// known all the same.
import { createRequire } from "node:module";
console.log(createRequire(__dirname + "/lib/")("./part.js").value);

// FILE: lib/part.js
exports.value = "part";
