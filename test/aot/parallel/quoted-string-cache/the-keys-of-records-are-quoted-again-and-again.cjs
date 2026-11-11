"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const records = JSON.parse('[{"id":1,"name":"a","kind":"x","size":3},{"type":"t","text":"u","role":"r","id":2}]');
for (let turn = 0; turn < 4 + more; turn++) for (const record of records) { let line = ""; for (const key of Object.keys(record)) line += JSON.stringify(key) + ":" + JSON.stringify(record[key]) + ","; said.push(line); }
console.log(said.join("\n"));
