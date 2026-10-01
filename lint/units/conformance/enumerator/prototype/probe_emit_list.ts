// The 8 names of skippedEmitTests against the enumeration and the committed baselines (research probe).
import { existsSync } from "node:fs";
import { enumerateInstances, skippedEmitTests, type Instance } from "./compiler_runner";
const tsgo = "/workspace/ref/typescript-go/testdata/baselines/reference";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot: root });
const stem = (i: Instance) => i.name.replace(/\.tsx?$/, "");
const found = new Set<string>();
for (const i of e.instances) {
  const base = i.casePath.slice(i.casePath.lastIndexOf("/") + 1);
  if (!skippedEmitTests.has(base)) continue;
  found.add(base);
  const have = ["errors.txt", "js", "types", "symbols"].filter(x => existsSync(`${tsgo}/submodule/${i.suite}/${stem(i)}.${x}`));
  console.log([i.casePath, JSON.stringify(i.configName), i.status, i.reason, "reference baselines: " + (have.join(",") || "none"), "tags: " + i.tags.join(",")].join("\t"));
}
console.log("names", skippedEmitTests.size, "found", found.size, "missing", [...skippedEmitTests.keys()].filter(k => !found.has(k)));
