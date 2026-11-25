"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const bag = {}; for (let i = 0; i < 3000 + more; i++) bag["k" + i * 7] = i;
const keys = Object.keys(bag); let sum = 0, wrong = 0;
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < keys.length; i++) { const quoted = JSON.stringify(keys[(i * 37 + turn) % keys.length]); sum = (sum * 31 + quoted.length + quoted.charCodeAt(quoted.length - 2)) % 1000003; if (quoted !== '"' + keys[(i * 37 + turn) % keys.length] + '"') wrong++; }
said.push(String(sum), String(wrong));
console.log(said.join("\n"));
