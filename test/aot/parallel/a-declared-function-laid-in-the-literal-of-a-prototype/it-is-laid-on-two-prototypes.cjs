// add() is declared by name and laid in the literals of two prototypes: its `this` is an instance of the one or of the other.
// Under: --aot-check=Validate: what is expected of `this` is tested at the entry, and the compiler's own checks look at both versions.
'use strict';
const unseen = x => [x][JSON.parse("0")];
function Tally(step) { this.sum = 0; this.step = step; this.last = -1; }
Tally.prototype = { add: add, constructor: Tally };
function add(x) { this.sum = this.sum + x * this.step; this.last = x; return this; }
function Other() { this.step = 10; this.sum = 1; }
Other.prototype = { add: add };
const a = new Tally(2), b = new Other();
for (let i = 0; i < 4; i++) { (i % 2 ? a : b).add(i); }
console.log(a.sum, a.last, b.sum, b.last, Object.keys(b).join());
