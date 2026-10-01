// Counts of the enumeration against the measured figures of the reference (research probe).
import { enumerateInstances } from "./compiler_runner";
const casesRoot = process.argv[2] ?? "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const t0 = performance.now();
const e = enumerateInstances({ casesRoot });
const t1 = performance.now();
const by = (f: (i: any) => string) => {
  const m = new Map<string, number>();
  for (const i of e.instances) m.set(f(i), (m.get(f(i)) ?? 0) + 1);
  return [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};
console.log("files", e.files, "dropped by skippedTests", e.droppedBySkippedTests.length, "instances", e.instances.length, "ms", (t1 - t0).toFixed(0));
console.log("by status", JSON.stringify(by(i => i.status)));
console.log("by suite,status", JSON.stringify(by(i => i.suite + ":" + i.status)));
const reasons = new Map<string, number>();
for (const i of e.instances) if (i.status !== "run") {
  const r = i.status + ": " + i.reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1 <path>");
  reasons.set(r, (reasons.get(r) ?? 0) + 1);
}
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(6), r);
console.log("notes:");
for (const [k, v] of e.notes) console.log(" ", k, JSON.stringify(v));
const names = new Set<string>();
let dup = 0;
for (const i of e.instances) { if (names.has(i.name)) { dup++; console.log("duplicate name", i.name); } names.add(i.name); }
console.log("duplicate names", dup);
