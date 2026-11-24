// A file that threw is no child; the next one is.
const base = m => require("node:path").basename(m.filename ?? m.id);
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_lib = __commonJS(function (exports, module) { try { require("./real.cjs"); } catch (e) { exports.e = e.message; } exports.v = require("./other.cjs").v; });
var lib = require_lib();
console.log(lib.e, lib.v, module.children.map(base).join());
