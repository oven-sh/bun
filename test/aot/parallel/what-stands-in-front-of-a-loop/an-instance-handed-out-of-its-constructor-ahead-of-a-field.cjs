// What stands in front of a loop: an instance handed out of its constructor ahead of a field.
"use strict";
function go(turns, self) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); sum += self.held.width + turn; } return sum; }
class Holder { constructor(turns) { this.early = go(turns, this); this.held = { width: Number("5") }; } }
const holder = new Holder(Number("0"));
console.log("SAID", holder.early, go(Number("3"), holder));
