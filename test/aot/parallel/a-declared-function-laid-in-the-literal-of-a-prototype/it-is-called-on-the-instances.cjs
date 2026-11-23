// add() is declared by name and laid in the literal that becomes Tally.prototype. It stores into `this`, but the text never enters it by `new`: it is a method of Tally, and its `this` is a Tally.
// Under: --aot-check=Validate: what is expected of `this` is tested at the entry, and the compiler's own checks look at both versions.
'use strict';
const unseen = x => [x][JSON.parse("0")];
function Tally(step) { this.sum = 0; this.step = step; this.last = -1; }
Tally.prototype = { add: add, constructor: Tally };
function add(x) { this.sum = this.sum + x * this.step; this.last = x; return this; }
const t = new Tally(3); for (let i = 0; i < 5; i++) t.add(i);
console.log(t.sum, t.last, t instanceof Tally, Object.keys(t).join());
