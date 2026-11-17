// A method of a class below Map reads this.size, sets, reads it again and deletes, all in one loop: the look at the structure is what the typed copy of the loop proves, so its turns stay typed.
// STATISTIC: BuiltinSubclassesCheckedByStructure >= 3
// Under: --aot-testing=CheckEffectsAtRunTime: the size is read between stores into the same map
"use strict";
class H extends Map { fill(n) { let s = 0; for (let i = 0; i < n; i++) { s += this.size; this.set(i & 31, i); s += this.size; if ((i & 15) === 15) this.delete(i & 31); s += this.size; } return s; } }
const one = new H(); let sum = 0;
for (let t = 0; t < 200; t++) sum = (sum + one.fill(50 + (t & 7))) % 1000003;
console.log(sum, one.size);
