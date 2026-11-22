const leaf = require("./leaf.cjs");
const lib = require("./barrel.cjs");
function say(f) { try { console.log(String(f())); } catch (e) { console.log(e.constructor.name + ": " + String(e.message).slice(0, 24)); } }
function run(n) { let s = 0; for (let i = 0; i < n; i++) s = (0, lib.add)(s, i); return s; }
say(() => run(JSON.parse("12")) + " " + lib.two);
say(() => Object.keys(lib).join() + " " + leaf.late);
