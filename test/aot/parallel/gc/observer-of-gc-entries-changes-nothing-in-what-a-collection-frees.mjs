// With an observer of the 'gc' entries of node:perf_hooks, Bun.gc(true) runs in another native frame. It frees the same objects there: what a round of the loop leaves without a name is collected with the observer as without it.
import { PerformanceObserver } from "node:perf_hooks";
const count = 32;
function make(i) {
  return { id: i, tag: i + 1 };
}
// Five of the objects keep a name until the collection is over. Answers which of all of them are there afterwards.
function round(first) {
  const refs = [];
  let k0, k1, k2, k3, k4;
  for (let i = 0; i < count; i++) {
    const made = make(i);
    refs.push(new WeakRef(made));
    if (i === first + 0) k0 = made;
    if (i === first + 1) k1 = made;
    if (i === first + 2) k2 = made;
    if (i === first + 3) k3 = made;
    if (i === first + 4) k4 = made;
  }
  Bun.gc(true);
  let kept = "";
  for (let i = 0; i < count; i++) kept += refs[i].deref() === undefined ? "." : "#";
  return kept + " " + (k0.id + k1.id + k2.id + k3.id + k4.id);
}
const observer = new PerformanceObserver(() => {});
let same = 0;
let named = 0;
let differs;
for (let first = 1; first < 12; first++) {
  // The same calls come before both rounds.
  observer.observe({ type: "gc" });
  observer.disconnect();
  const without = round(first);
  observer.observe({ type: "gc" });
  const observed = round(first);
  observer.disconnect();
  if (without === observed) same++;
  else differs ??= without + " without an observer, " + observed + " with one";
  if (observed.slice(first, first + 5) === "#####") named++;
}
console.log(same, "rounds of 11 free the same with an observer;", named, "keep what has a name");
if (differs) console.log("the first round that differs:", differs);
if (same !== 11 || named !== 11) process.exitCode = 1;
