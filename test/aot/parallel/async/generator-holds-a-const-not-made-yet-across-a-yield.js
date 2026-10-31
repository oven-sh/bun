// Flags: --aot-testing=CheckProofsAtRunTime
// A const of a loop is live across the yield in SSA form on the turn that has not made it yet. Its word is empty there, and no claim says otherwise.
globalThis.k = 0;
globalThis.vlength = 0;
const seen = [];
globalThis.out = value => seen.push(value.length);
function* made(rounds) {
  for (let round = 0; round < rounds; ) {
    const w = new Int32Array().subarray();
    yield;
    k = 0;
    if (vlength > 0)
      do;
      while (k < vlength);
    out(w);
    round++;
  }
}
let count = 0;
for (const _ of made(4)) count++;
console.log(count, seen);
const steps = made(2);
let step = steps.next();
while (!step.done) step = steps.next();
console.log(seen.length);
