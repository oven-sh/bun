import path, { sep, join } from "node:path";
const found = path.sep + " " + path.join("a", "b");
path.sep = "!";
path.join = () => "patched by the worker";
postMessage([found, "and then", sep, join("a", "b"), path.sep, path.join("a", "b")].join(" "));
