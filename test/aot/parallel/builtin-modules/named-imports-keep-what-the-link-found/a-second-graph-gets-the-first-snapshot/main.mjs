// A second graph that is linked behind a store into node:path gets the named import that the entry got, and so does an import() of the module.
import path, { sep } from "node:path";
path.sep = "!";
await import("./second.mjs");
const names = await import("node:path");
console.log("the entry:", sep, path.sep, names.sep, names.default === path);
