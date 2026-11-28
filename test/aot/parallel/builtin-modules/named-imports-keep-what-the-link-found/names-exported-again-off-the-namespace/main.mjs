// The namespace object of a file that exports names of node:path again is listed and read by computed keys before compiled code reads any of those names.
import os, { sep, j } from "./re.mjs";
const path = require("node:path");
path.sep = "!";
path.join = () => "patched";
const names = await import("./re.mjs");
const keys = Object.keys(names);
console.log(keys);
console.log(
  keys.map(key => typeof names[key]).join(" "),
  names.sep,
  names.j("a", "b"),
  names.default === require("node:os"),
);
console.log(sep, j("a", "b"), os === names.default);
