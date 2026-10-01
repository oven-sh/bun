// Prototype of kind and tags: reads the error baselines and the two lists of the reference.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Instance, Suite } from "./compiler_runner";

// baseline.go:110
export function readFileNameSet(path: string): Set<string> {
  const set = new Set<string>();
  for (let line of readFileSync(path, "utf8").split("\n")) {
    line = line.trim();
    if (line === "" || line[0] === "#") continue;
    set.add(line);
  }
  return set;
}

// tsbaseline/util.go:13 with error_baseline.go:36
export function errorBaselineName(configuredName: string): string {
  return configuredName.replace(/\.tsx?$/, ".errors.txt");
}

export interface OracleSources {
  // directory with one directory per suite that holds the error baselines of typescript-go
  tsgoBaselines: string;
  accepted: Set<string>;
  triaged: Set<string>;
  // base names whose diagnostics depend on the emit that precedes them in the reference; the names are not known yet
  postEmitOrder: Set<string>;
}

export function annotate(instances: Instance[], src: OracleSources): void {
  const have = new Map<Suite, Set<string>>();
  for (const suite of ["compiler", "conformance"] as const) {
    const dir = src.tsgoBaselines + "/" + suite;
    have.set(suite, new Set(existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".errors.txt")) : []));
  }
  for (const i of instances) {
    if (i.status !== "run") continue;
    const file = errorBaselineName(i.name);
    i.kind = have.get(i.suite)!.has(file) ? "E" : "C";
    const key = `${i.suite}/${file}.diff`;
    if (src.accepted.has(key)) i.tags.push("accepted");
    if (src.triaged.has(key)) i.tags.push("triaged");
    const base = i.casePath.slice(i.casePath.lastIndexOf("/") + 1);
    if (src.postEmitOrder.has(base)) i.tags.push("post-emit-order");
  }
}
