// add() is declared by name and laid in the literal that becomes Tally.prototype. It is borrowed by call() for a record out of JSON.parse, for a literal and for an object without a prototype: whatever is expected of `this` fails there.
// Under: --aot-check=Validate: what is expected of `this` is tested at the entry, and the compiler's own checks look at both versions.
'use strict';
const unseen = x => [x][JSON.parse("0")];
function Tally(step) { this.sum = 0; this.step = step; this.last = -1; }
Tally.prototype = { add: add, constructor: Tally };
function add(x) { this.sum = this.sum + x * this.step; this.last = x; return this; }
for (const other of [JSON.parse('{"sum":1,"step":2}'), { step: 5, sum: 0, more: true }, Object.assign(Object.create(null), { sum: 2, step: 2 })]) { const back = Tally.prototype.add.call(unseen(other), 4); console.log(back === other, other.sum, other.last, Object.keys(other).join()); }
console.log(new Tally(2).add(3).sum);
