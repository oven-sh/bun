"use strict";
globalThis.runs = 0;
let out = "";
function load() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return require("./shaky.cjs"); }
try { load(); } catch (e) { out += e.message + ";"; }
for (let i = 0; i < 3; i++) { const got = load(); out += typeof got + String(got.early) + String(typeof got === "function" ? got(i) : got.late) + ";"; }
out += globalThis.runs;
console.log(out);
