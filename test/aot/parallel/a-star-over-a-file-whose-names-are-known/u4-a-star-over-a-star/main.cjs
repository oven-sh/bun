"use strict";
const lib = require("./index.cjs");
const leaf = require("./a.cjs");
function show(o) { return Object.keys(o).join(",") + " | " + Object.getOwnPropertyNames(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + ":" + ("get" in d ? "get" : "value") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + (d.writable ? "w" : ""); }).join(","); }
let s = 0; for (let i = 0; i < 50; i++) s = lib.add(s, i) % 1009;
console.log(s, lib.count, lib.mid, show(lib));
leaf.add = function (a, b) { return a - b; };
console.log(lib.add(5, 3), require("./mid.cjs").add(5, 3));
