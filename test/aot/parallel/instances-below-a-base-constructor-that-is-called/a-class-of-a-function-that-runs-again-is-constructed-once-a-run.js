// A class is written in a function that runs 300,000 times and constructs it once a run: every prototype object is new and is met once: the run time is asked each time, and remembers nothing of it, for nobody would look it up.
// COUNT: counter:InstancesRememberedBelowPrototypes <= 100
"use strict";
function once(round) {
  class Lone { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; this.name = "l" + (n & 1); } }
  return new Lone(round);
}
let sum = 0;
for (let round = 0; round < 300000; round++) sum += once(round).size;
console.log(sum);
