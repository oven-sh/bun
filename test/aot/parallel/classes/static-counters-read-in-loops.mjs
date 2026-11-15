// A static field of two mixins is counted up through the heirs, and a loop reads it off the heirs: the first store ends the guards of the name, and the others are plain stores.
// Env: JSC_aotCountsPath=/dev/null
// COUNT: operation:operationAOTPutById <= 100
const Counted = Parent => class extends Parent { static count = 0; constructor(...all) { super(...all); this.order = ++new.target.count; } };
class Item { constructor(id) { this.id = id; } }
class Both extends Counted(Item) {}
class Other extends Counted(Both) {}
function sum(n) { let t = 0; for (let k = 0; k < n; k++) t += Both.count + Other.count & 7; return t; }
let t = 0;
for (let k = 0; k < 4000; k++) { t += new Both(k & 63).order & 7; t += new Other(k & 63).order & 3; }
console.log(t, sum(10));
