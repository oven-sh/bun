'use strict';
class Tally { static next = 1; }
function read() { return Tally.next; }
function store(value) { Tally.next = value; }
store(3);
const seen = [read()];
Object.freeze(Tally);
let said = '';
try { store(8); } catch (error) { said = error.constructor.name; }
seen.push(read());
console.log(seen.join(), said);
