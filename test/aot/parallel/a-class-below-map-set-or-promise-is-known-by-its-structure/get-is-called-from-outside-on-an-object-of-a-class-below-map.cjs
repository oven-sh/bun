// A loop outside of the class calls get on an object of a class below Map: the look at the structure is asked, not whether a plain Map is as it was made, which no such object is.
// STATISTIC: HeirsTestedByTheirStructure >= 2
// COUNT: counter:StructuresOfHeirsRemembered >= 1
// COUNT: operation:operationAOTFillSiteCache = 0
"use strict";
class H extends Map { constructor() { super(); this.hits = 0; } }
const one = new H(); for (let k = 0; k < 8; k++) Map.prototype.set.call(one, k, k);
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) s = (s + one.get(i & 7)) & 4095; return s; }
const turns = +(process.argv[2] ?? 300); let sum = 0;
for (let t = 0; t < turns; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
