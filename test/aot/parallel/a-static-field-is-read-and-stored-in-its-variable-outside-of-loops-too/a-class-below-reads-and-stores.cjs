'use strict';
class Tally { static next = 1; }
class Finer extends Tally { }
function readAbove() { return Tally.next; }
function readBelow() { return Finer.next; }
const seen = [readAbove(), readBelow()];
Tally.next = 4; seen.push(readAbove(), readBelow());
Finer.next = 9; seen.push(readAbove(), readBelow());
Tally.next = 6; seen.push(readAbove(), readBelow());
console.log(seen.join(), Object.keys(Finer).join());
