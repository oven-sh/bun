'use strict';
class Tally { static next = 1; static step = 3; }
function read() { return Tally.next; }
function store(value) { Tally.next = value; }
const seen = [read()];
store(5); seen.push(read());
delete Tally.next; seen.push(read());
store(9); seen.push(read());
console.log(seen.join(), Object.keys(Tally).join());
