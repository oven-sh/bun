// RUN: lower
// OPTIONS: builtin-modules

// One name is imported and require under another name is called in a function.
import { basename } from "node:path";
const load = require;
function get(name) { return load(name); }
console.log(basename("/a/b.txt"), get("node:" + "path").join("a", "b"), get("node:pa" + "th").extname("x.js"));

// CHECK-LABEL: function {{*}}name="get"
