'use strict';
class Tally { static next = 1; static step = 3; }
const key = JSON.parse('"next"');
function take() { const was = Tally.next; Tally.next = was + Tally.step; return was; }
let sum = 0;
for (let i = 0; i < 7; i++) sum += take();
Tally[key] = 100;
sum += take();
console.log(sum, Tally.next, Object.keys(Tally).join(), Tally[key]);
