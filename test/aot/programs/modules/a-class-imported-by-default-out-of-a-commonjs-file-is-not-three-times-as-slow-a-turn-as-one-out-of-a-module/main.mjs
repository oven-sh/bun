// One class and one function, each written twice: as what a CommonJS file assigns to module.exports, and as the default export of a module. Both are imported by default. A turn with the first pair may cost a little more than a turn with the second, not three times as much.
import AssignedCounter from "./assigned-counter.cjs";
import assignedTwice from "./assigned-twice.cjs";
import ExportedCounter from "./exported-counter.mjs";
import exportedTwice from "./exported-twice.mjs";
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
let sums = 0;
const exported = fastestOf(5, () => {
  const counter = new ExportedCounter();
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + counter.add(i) + exportedTwice(i)) | 0;
  sums = (sums + sum) | 0;
});
const assigned = fastestOf(5, () => {
  const counter = new AssignedCounter();
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + counter.add(i) + assignedTwice(i)) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums);
console.log(assigned < exported * 3 ? "under three times the time" : "over three times the time");
