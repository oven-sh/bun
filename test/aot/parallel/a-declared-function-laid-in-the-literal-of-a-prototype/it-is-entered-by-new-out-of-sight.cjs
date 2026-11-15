// add() is declared by name and laid in the literal that becomes Tally.prototype. The text never enters it by `new`, but a value that nobody can follow does: the object born there is an instance of add, not a Tally.
// Under: --aot-check=Validate: what is expected of `this` is tested at the entry, and the compiler's own checks look at both versions.
'use strict';
const unseen = x => [x][JSON.parse("0")];
function Tally(step) { this.sum = 0; this.step = step; this.last = -1; }
Tally.prototype = { add: add, constructor: Tally };
function add(x) { this.sum = this.sum + x * this.step; this.last = x; return this; }
const Hidden = unseen(Tally.prototype.add); const born = new Hidden(4);
console.log(born instanceof add, born instanceof Tally, Number.isNaN(born.sum), born.last, Object.keys(born).join());
console.log(new Tally(2).add(3).sum);
