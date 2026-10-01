#!/usr/bin/env bash
# usage: equiv.sh <tree> [corpus root] [revision]
# In a tree with the binding in place: cuts the glue that sweep.ts carried at the revision (default 3110ce85cf, its lines
# 78-79 and 248-366) into a module of its own and holds it against runner/corpus.ts in one process, for every case of the
# corpus (default: the corpus of the tree): listCases, caseBaseName, directoryOf, the facts of each instance, its tags,
# the instance that a run takes, the platform limit and the input of every instance that runs. A few seconds, no lock.
set -euo pipefail
tree=$(cd -- "${1:?usage: equiv.sh <tree> [corpus root] [revision]}" && pwd)
R=$tree/test/cli/lint/conformance/runner
corpus=${2:-$tree/test/cli/lint/conformance/corpus}
revision=${3:-3110ce85cf}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
{
  cat <<HEAD
import { readdirSync } from "node:fs";
import type { InputResult, Instance, InstanceFacts } from "$R";
import { type EnumeratedInstance } from "$R/compiler_runner";
import { type CompilerTest, type InstanceInput, type Platform, findObstacles, instanceInput } from "$R/materialise";
import { type Oracle, type OracleTable, diffRootOf, oracleOf } from "$R/oracle";
import { type CorpusPaths, suites } from "$R/paths";
import { type TestUnit, parseTestFilesAndSymlinks } from "$R/test_case_parser";
import { readFile } from "$R/vfs";
HEAD
  git -C "$tree" show "$revision:test/cli/lint/conformance/sweep.ts" | sed -n '78,79p;248,366p'
  echo 'export { caseBaseName, directoryOf, listCases, factOf, inputOf };'
} > "$tmp/old-glue.ts"
cat > "$tmp/equiv.ts" <<BODY
import { enumerateCase } from "$R/compiler_runner";
import { caseBaseName, directoryOf, listCases, openCorpus } from "$R";
import { loadOracleTable } from "$R/oracle";
import { corpusPaths } from "$R/paths";
import * as old from "./old-glue.ts";

const root = process.argv[2];
const paths = corpusPaths(root);
const table = loadOracleTable(paths);
const corpus = openCorpus(root);
const cases = old.listCases(paths.cases);
const differ: string[] = [];
if (JSON.stringify(cases) !== JSON.stringify(listCases(paths.cases))) differ.push("listCases");
const entries = (config: ReadonlyMap<string, string> | undefined) => (config === undefined ? null : [...config]);
const counts = { cases: cases.length, instances: 0, run: 0, skipped: 0, invalid: 0, limited: 0 };
for (const casePath of cases) {
  if (old.directoryOf(casePath) !== directoryOf(casePath)) differ.push("directoryOf " + casePath);
  const before = enumerateCase(paths.cases, casePath).map(e => old.factOf(e, casePath, table, paths));
  const after = corpus.enumerateCase(casePath);
  if (before.length !== after.length) {
    differ.push(casePath + ": " + before.length + " instances before, " + after.length + " after");
    continue;
  }
  for (let k = 0; k < before.length; k++) {
    const f = before[k];
    const i = after[k];
    const g = corpus.facts(i);
    counts.instances++;
    counts[f.status === "run" ? "run" : f.status]++;
    if (old.caseBaseName(f.name) !== caseBaseName(i.name)) differ.push("caseBaseName " + f.name);
    const a = {
      name: f.name,
      directory: f.directory,
      casePath: f.casePath,
      status: f.status,
      reason: f.reason,
      kind: f.kind ?? null,
      tags: f.tags.join(","),
      run: f.run === undefined ? null : { ...f.run, config: entries(f.run.config) },
    };
    const b = {
      name: g.name,
      directory: g.directory,
      casePath: g.casePath,
      status: g.status,
      reason: g.reason,
      kind: g.kind ?? null,
      tags: (["accepted", "triaged"] as const).filter(tag => i[tag]).join(","),
      run:
        g.status !== "run"
          ? null
          : { name: i.name, status: i.status, casePath: i.casePath, config: entries(i.config), oracle: i.oracle },
    };
    if (JSON.stringify(a) !== JSON.stringify(b)) differ.push(f.name + "\n  " + JSON.stringify(a) + "\n  " + JSON.stringify(b));
    if (g.instance !== i) differ.push(f.name + ": the facts do not hold the instance");
    if ((f.status === "invalid") !== (i.invalidReason !== undefined)) differ.push(f.name + ": invalidReason " + i.invalidReason);
    if (f.status === "invalid" && i.invalidReason !== f.reason) differ.push(f.name + ": invalidReason " + i.invalidReason);
    if (f.run === undefined) continue;
    if (f.platformLimited !== g.platformLimited) differ.push(f.name + ": platformLimited");
    if (f.platformLimited !== undefined) counts.limited++;
    const x = JSON.stringify(old.inputOf(paths, f.run, undefined));
    if (x !== JSON.stringify(corpus.input(i, undefined))) differ.push(f.name + ": input");
  }
}
console.log(JSON.stringify(counts));
console.log(differ.length === 0 ? "the same" : differ.length + " differences:\n" + differ.slice(0, 20).join("\n"));
process.exit(differ.length === 0 ? 0 : 1);
BODY
bun "$tmp/equiv.ts" "$corpus"
