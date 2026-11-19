// DIAGNOSTIC: TS100094 main.mjs:7
// DIAGNOSTIC: TS100094 main.mjs:8
// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/part.cjs"

// FILE: main.mjs
// The call stays an ordinary call, so nothing behind the front end sees a load in it: the front end says itself that it can't read the name. A name with a query is one that it can't read.
import { createRequire } from "node:module";
let load;
try {
  load = createRequire(import.meta.url);
} catch {}
console.log(load(process.argv[2]).value);
console.log(load("./part.cjs?again").value);
console.log(load("./part.cjs").value);

// FILE: part.cjs
exports.value = "part";
