// What the harness would do with the 45 files of skippedTests if they were not dropped (research probe).
import { enumerateInstances, skippedTests } from "./compiler_runner";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot: root, includeSkippedTests: true });
const set = new Set(skippedTests);
const seen = new Set<string>();
const rows: string[] = [];
let inst = 0;
const byStatus = new Map<string, number>();
for (const i of e.instances) {
  const base = i.casePath.slice(i.casePath.lastIndexOf("/") + 1);
  if (!set.has(base)) continue;
  inst++;
  seen.add(base);
  byStatus.set(i.status, (byStatus.get(i.status) ?? 0) + 1);
  rows.push([i.casePath, JSON.stringify(i.configName), i.status, i.reason].join("\t"));
}
console.log("names in the list:", skippedTests.length, "unique:", set.size, "found as files:", seen.size, "instances they would make:", inst);
console.log("missing:", skippedTests.filter(n => !seen.has(n)));
console.log(JSON.stringify([...byStatus]));
for (const r of rows) console.log(r);
const outside = e.instances.filter(i => i.status === "invalid" && !set.has(i.casePath.slice(i.casePath.lastIndexOf("/") + 1)));
console.log("invalid outside the list:", outside.length);
