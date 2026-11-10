'use strict';
class Tally { static next = 1; }
function read() { return Tally.next; }
function store(value) { Tally.next = value; }
const seen = [read()];
let asked = 0, kept = 40;
Object.defineProperty(Tally, 'next', { get() { asked++; return kept + asked; }, set(value) { kept = value * 2; }, configurable: true });
seen.push(read()); store(7); seen.push(read());
console.log(seen.join(), asked, kept);
