'use strict';
class Tally { static next = 2147483640; }
function take(rounds) { let last = 0; for (let i = 0; i < rounds; i++) last = Tally.next++; return last; }
console.log(take(5), take(10), Tally.next, take(3));
