"use strict";
globalThis.runs = 0;
globalThis.readers = [];
function load() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return require("./shaky.cjs"); }
let out = "";
try { load(); } catch (e) { out += e.message + ";"; }
const got = load();
out += got.run + ";" + globalThis.readers[0]() + ";" + globalThis.readers[1]();
console.log(out);
