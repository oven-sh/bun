// A name that is added to node:path before a file is linked is in the namespace of that file, and one that is deleted is not.
const path = require("node:path");
delete path.sep;
path.nope = 1;
await import("./late.mjs");
path.later = 2;
console.log("later" in (await import("node:path")));
