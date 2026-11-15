// COUNTER: operationAOTGetByVal <= 40
"use strict";
const hide = v => [v][JSON.parse("0")];
const receivers = [new Map(), new Set(), JSON.parse("{}"), JSON.parse('{"length":300,"a":1}'), Object.create(null), new Date(0), Promise.resolve(1), new WeakMap(), Object.assign(new Map(), { length: 300 }), Object.create(new Map()), Object.create(Object.create(JSON.parse('{"a":1}')))].map(hide);
function count(o, turns) { let found = 0; for (let i = 0; i < turns; i++) found += o[i] === undefined ? 0 : 1; return found; }
let total = 0;
for (const o of receivers) total += count(o, 300);
console.log(total, receivers.length);
