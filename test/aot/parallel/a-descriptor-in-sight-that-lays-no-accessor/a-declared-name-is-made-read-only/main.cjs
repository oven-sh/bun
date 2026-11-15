"use strict";
const lib_1 = require("./lib.cjs");
const text = new Function(JSON.parse("\"return 1\""));
const turns = Number(process.argv[2] || 64);
const items = [lib_1.makeItem(1), lib_1.makeItem(2), lib_1.makeItem(3), lib_1.makeItem(4)];
function total(list, n) { let s = 0; for (let i = 0; i < n; i++) { const item = list[i & 3]; s = (s + item.id + item.weight) | 0; } return s; }
console.log("SAID", total(items, turns), items[3].secret, text());
