'use strict';
class Tally { static next = 3; }
function sum(rounds) { let s = 0; for (let i = 0; i < rounds; i++) s += Tally.next; return s; }
const seen = [sum(4)];
delete Tally.next; seen.push(String(sum(2)));
Tally.next = 6; seen.push(sum(2));
console.log(seen.join('|'));
