"use strict";
const lib = require("./index.cjs");
function show(o) { return Object.keys(o).join(",") + " | " + Object.getOwnPropertyNames(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + ":" + ("get" in d ? "get" : "value") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + (d.writable ? "w" : ""); }).join(","); }
let s = 0; for (let i = 0; i < 50; i++) s = (lib.add(s, i) + lib.add2(i)) % 1009;
console.log(s, lib.first, lib.last, lib.zeta, lib[7], show(lib));
