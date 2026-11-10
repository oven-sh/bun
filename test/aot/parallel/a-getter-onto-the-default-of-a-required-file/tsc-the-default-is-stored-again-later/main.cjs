const lib = require("./barrel.cjs");
function run(n) { let s = 0; for (let i = 0; i < n; i++) s = (0, lib.add)(s, i); return s; }
function say(f) { try { console.log(String(f())); } catch (e) { console.log(e.constructor.name + ": " + e.message); } }
say(() => run(JSON.parse("12")));
require("./leaf.cjs").swap();
say(() => run(JSON.parse("12")));
