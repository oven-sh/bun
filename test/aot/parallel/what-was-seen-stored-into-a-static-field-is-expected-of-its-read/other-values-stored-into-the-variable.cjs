'use strict';
class Tally { static next = 1; }
const odd = JSON.parse('["seven", 2.5, null, {"a":1}, true, 4]');
function put(value) { Tally.next = value; }
function sum(rounds) { let s = 0; for (let i = 0; i < rounds; i++) s += Tally.next; return s; }
const seen = [sum(5)];
for (const value of odd) { put(value); seen.push(String(sum(3))); }
console.log(seen.join('|'));
