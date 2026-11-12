globalThis.hook = function () { try { return Object.keys(require("./barrel.cjs")).length + " " + typeof require("./barrel.cjs").add; } catch (e) { return e.constructor.name; } };
const lib = require("./barrel.cjs");
function say(f) { try { console.log(String(f())); } catch (e) { console.log(e.constructor.name + ": " + String(e.message).slice(0, 24)); } }
function run(n) { let s = 0; for (let i = 0; i < n; i++) s = (0, lib.add)(s, i); return s; }
say(() => run(JSON.parse("12")) + " " + lib.two);
console.log("behind", globalThis.hook());
