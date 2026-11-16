'use strict';
const rounds = Number(process.argv[2] ?? 2000), gap = Number(process.argv[3] ?? 11);
const esc = String.fromCharCode(27), letters = JSON.parse('"abcdefghijklmnopqrstuvwxyz"');
let sum = 0;
const text = (esc + letters.slice(0, gap)).repeat(170);
for (let round = 0; round < rounds; round++) sum += text.search(/\u001b\[[0-9;]*m/);
console.log('SAID ' + sum);
