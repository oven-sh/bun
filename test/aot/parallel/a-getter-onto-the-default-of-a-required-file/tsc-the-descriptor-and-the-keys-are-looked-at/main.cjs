const lib = require("./barrel.cjs");
function run(n) { let s = 0; for (let i = 0; i < n; i++) s = (0, lib.add)(s, i); return s; }
function say(f) { try { console.log(String(f())); } catch (e) { console.log(e.constructor.name + ": " + e.message); } }
say(() => run(JSON.parse("12")));
const d = Object.getOwnPropertyDescriptor(lib, "add");
console.log(Object.keys(d).join(), typeof d.get, d.enumerable, d.configurable, Object.keys(lib).join(), JSON.stringify(Object.getOwnPropertyNames(lib)));
