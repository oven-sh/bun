// Heap snapshots are taken while functions that capture objects are made and let go. Each shows a scope for every function that is held, and once it is taken nothing of it stays in the heap.
import * as jsc from "bun:jsc";
const take = Reflect.get(jsc, "generateHeapSnapshotForDebugging");
const scopesInHeap = () => jsc.heapStats().objectTypeCounts.JSLexicalEnvironment ?? 0;
function collect() {
  Bun.gc(true);
  Bun.gc(true);
}
function make(n) {
  const kept = { n };
  return () => kept.n;
}
// The functions under the property `mark_of_the_list` that lead to a scope which holds a variable called `kept`.
function functionsWithScope() {
  const raw = take();
  const snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
  const classOf = new Map();
  for (let i = 0; i < snapshot.nodes.length; i += 7) classOf.set(snapshot.nodes[i], snapshot.nodeClassNames[snapshot.nodes[i + 2]]);
  const holdsKept = new Set();
  let list = -1;
  for (let i = 0; i < snapshot.edges.length; i += 4) {
    const kind = snapshot.edgeTypes[snapshot.edges[i + 2]];
    if (kind === "Variable" && snapshot.edgeNames[snapshot.edges[i + 3]] === "kept" && classOf.get(snapshot.edges[i]) === "JSLexicalEnvironment") holdsKept.add(snapshot.edges[i]);
    if (kind === "Property" && snapshot.edgeNames[snapshot.edges[i + 3]] === "mark_of_the_list") list = snapshot.edges[i + 1];
  }
  const members = new Set();
  for (let i = 0; i < snapshot.edges.length; i += 4) if (snapshot.edges[i] === list && classOf.get(snapshot.edges[i + 1]) === "Function") members.add(snapshot.edges[i + 1]);
  const found = new Set();
  for (let i = 0; i < snapshot.edges.length; i += 4) if (members.has(snapshot.edges[i]) && holdsKept.has(snapshot.edges[i + 1])) found.add(snapshot.edges[i]);
  return found.size;
}
const holder = (globalThis.keptForTheWalk = { mark_of_the_list: [] });
let sum = 0;
for (const count of [2000, 10, 5000, 0, 300]) {
  holder.mark_of_the_list = Array.from({ length: count }, (_, n) => make(n));
  for (let n = 0; n < 3000; n++) sum += make(n)();
  collect();
  const before = scopesInHeap();
  const found = functionsWithScope();
  collect();
  console.log(count, "functions held:", found, "lead to a scope with the variable; scopes left behind the snapshot:", scopesInHeap() - before);
}
console.log(typeof Bun.generateHeapSnapshot("v8"), typeof Bun.generateHeapSnapshot(), sum);
collect();
