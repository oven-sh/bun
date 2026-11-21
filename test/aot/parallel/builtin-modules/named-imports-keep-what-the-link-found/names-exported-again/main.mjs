// Names of node:path that a file exports again keep what the link found when a required node:path is stored into.
import os, { sep, j } from "./re.mjs";
const path = require("node:path");
path.sep = "!";
path.join = () => "patched";
console.log(sep, j("a", "b"), path.sep, path.join("a", "b"), os === require("node:os"));
const names = await import("./re.mjs");
console.log(Object.keys(names), names.sep, names.j("a", "b"), names.default === os);
