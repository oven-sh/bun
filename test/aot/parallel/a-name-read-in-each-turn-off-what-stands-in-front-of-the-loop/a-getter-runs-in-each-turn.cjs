"use strict";
let calls = 0;
const holders = JSON.parse('[{"port":5},null]');
holders[1] = { get port() { return calls++; } };
function sum(holder) { let s = 0; for (let i = 0; i < 40; i++) s += holder.port * 2; return s; }
const found = { sum }[JSON.parse('"sum"')];
for (let t = 0; t < 2000; t++) found(holders[0]);
console.log(found(holders[0]), calls);
console.log(found(holders[1]), calls);
console.log(found(holders[1]), calls);
