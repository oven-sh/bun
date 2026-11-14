"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const record = JSON.parse('{"alpha7":1,"beta7":2}'), seen = new Map();
for (let turn = 0; turn < 3; turn++) for (const stem of ["alpha", "beta", "gamma"]) { const fresh = stem + (7 + more); said.push(JSON.stringify(fresh)); seen.set(fresh, turn); said.push(JSON.stringify(fresh), String(fresh in record), JSON.stringify(fresh)); }
for (const key of Object.keys(record)) said.push(JSON.stringify(key));
said.push(String(seen.size));
console.log(said.join("\n"));
