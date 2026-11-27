"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const record = JSON.parse('{"delta":1,"alpha":2}');
for (let turn = 0; turn < 3 + more; turn++) { const frozen = Object.freeze(Object.keys(record)); try { frozen.sort(); said.push("sorted " + frozen.join()); } catch (error) { said.push(error.constructor.name + " " + frozen.join()); } const named = Object.keys(record); named.label = "l" + turn; said.push(named.sort().join(), named.label, Object.keys(named).join()); const again = Object.keys(record).sort(); again.label = turn; said.push(again.join(), String(again.label)); }
console.log(said.join("\n"));
