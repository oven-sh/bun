'use strict';
function read(which) { return which.next; }
const seen = [];
class Tally { static first = seen.push(Tally.next === undefined ? 'nothing yet' : 'there'); static next = 1; static last = seen.push(Tally.next); }
function own() { return Tally.next; }
seen.push(own(), read(Tally));
console.log(seen.join());
