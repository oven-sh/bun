"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const record = JSON.parse('{"delta":1,"alpha":2,"charlie":3,"bravo":4}');
for (let turn = 0; turn < 5 + more; turn++) { const keys = Object.keys(record).sort(); said.push(keys.join()); if (turn % 5 === 0) keys[0] = "zulu" + turn; if (turn % 5 === 1) keys.push("more"); if (turn % 5 === 2) keys.length = 2; if (turn % 5 === 3) keys.reverse(); if (turn % 5 === 4) keys.splice(1, 1); said.push(keys.join(), Object.keys(record).join(), Object.keys(record).sort().join()); }
console.log(said.join("\n"));
