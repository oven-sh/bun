"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const records = []; for (let i = 0; i < 900 + more; i++) records.push(JSON.parse('{"z' + i + '":1,"m' + i * 3 + '":2,"a' + i * 7 + '":3}'));
let wrong = 0, sum = 0;
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < records.length; i++) { const record = records[(i * 37 + turn) % records.length], keys = Object.keys(record).sort(); if (keys.length !== 3 || !(keys[0] in record) || !(keys[1] in record) || !(keys[2] in record) || keys[0] > keys[1] || keys[1] > keys[2]) wrong++; sum = (sum * 31 + keys[0].length + keys[2].charCodeAt(1)) % 1000003; }
said.push(String(wrong), String(sum));
console.log(said.join("\n"));
