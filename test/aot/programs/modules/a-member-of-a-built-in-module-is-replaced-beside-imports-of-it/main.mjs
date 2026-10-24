// A member of a built in module is replaced beside imports of it.
import path, { basename } from "node:path";
import * as ns from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const viaRequire = require("path");
console.log(viaRequire === path, ns.default === path);
viaRequire.basename = () => "replaced";
console.log(path.basename("/a/b"), basename("/a/b"), ns.basename("/a/b"), ns.default.basename("/a/b"));
