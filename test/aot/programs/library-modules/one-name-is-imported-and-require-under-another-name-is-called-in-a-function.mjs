import { basename } from "node:path";
const load = require;
function get(name) { return load(name); }
console.log(basename("/a/b.txt"), get("node:" + "path").join("a", "b"), get("node:pa" + "th").extname("x.js"));
