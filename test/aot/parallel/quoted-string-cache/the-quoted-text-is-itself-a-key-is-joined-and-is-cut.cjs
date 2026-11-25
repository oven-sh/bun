"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const record = JSON.parse('{"alpha":1,"beta":2,"gamma":3}'), byQuoted = {};
for (let turn = 0; turn < 3 + more; turn++) for (const key of Object.keys(record)) { const quoted = JSON.stringify(key); byQuoted[quoted] = (byQuoted[quoted] ?? 0) + 1; said.push(quoted + quoted, quoted.slice(1, -1), String(quoted === JSON.stringify(key)), JSON.stringify(quoted), quoted.toUpperCase(), String(quoted.charCodeAt(0))); }
said.push(JSON.stringify(byQuoted));
console.log(said.join("\n"));
