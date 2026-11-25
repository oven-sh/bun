// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/lib/part.js"
// CHECK: EvaluateModule {{*}}[isCallOfRequire]

// FILE: main.mjs
// The base is a URL made from the file's own: the folder that the require looks from is known, as with a path from the own directory.
import { createRequire } from "node:module";
console.log(createRequire(new URL("./lib/", import.meta.url))("./part.js").value);

// FILE: lib/part.js
exports.value = "part";
