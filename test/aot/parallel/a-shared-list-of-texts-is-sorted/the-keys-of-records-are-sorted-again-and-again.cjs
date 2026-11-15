"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const records = JSON.parse('[{"id":1,"name":"a","kind":"x"},{"type":"t","text":"u","role":"r","id":2},{"b":1,"a":2,"d":3,"c":4},{"only":1},{"a":1,"b":2}]');
for (let turn = 0; turn < 4 + more; turn++) for (const record of records) said.push(Object.keys(record).sort().join() + " | " + Object.keys(record).join());
console.log(said.join("\n"));
