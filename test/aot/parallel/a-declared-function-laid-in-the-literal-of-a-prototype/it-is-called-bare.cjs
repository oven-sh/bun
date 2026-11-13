// add() is declared by name and laid in the literal that becomes Tally.prototype. Called bare in strict code its `this` is undefined, and on a number it is the number: the errors are those of `bun <file>`.
// Under: --aot-check=Validate: what is expected of `this` is tested at the entry, and the compiler's own checks look at both versions.
'use strict';
const unseen = x => [x][JSON.parse("0")];
function Tally(step) { this.sum = 0; this.step = step; this.last = -1; }
Tally.prototype = { add: add, constructor: Tally };
function add(x) { this.sum = this.sum + x * this.step; this.last = x; return this; }
const bare = unseen(Tally.prototype.add);
for (const way of [() => bare(1), () => add(2), () => bare.call(5, 1), () => bare.call(null, 1)]) { try { console.log(typeof way()); } catch (error) { console.log(error.name, error.message); } }
console.log(new Tally(2).add(3).sum);
