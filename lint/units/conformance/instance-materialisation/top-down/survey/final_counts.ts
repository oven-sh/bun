// The counts of instances that get the status of their own, by platform and by kind of check function.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { enumerateFiles, getCompilerFileBasedTest, getConfiguredName, skippedTests } from "../../../enumerator/prototype/compiler_runner";
import { getBaseFileName } from "../../../enumerator/prototype/tspath";
import { readFile } from "../../../enumerator/prototype/vfs";
import { newCompilerTest } from "../prototype/compiler_test";
import { findObstacles, type Platform } from "../prototype/materialize";

const casesRoot = process.argv[2] ?? "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const tsv = gunzipSync(readFileSync(import.meta.dir + "/../../../enumerator/vectors/instances.tsv.gz")).toString("utf8").split("\n").filter(Boolean).slice(1).map(l => l.split("\t"));
const info = new Map(tsv.map(t => [t[1] + "/" + t[0], { run: t[4] === "run", kind: t[6] }]));
const resolutions = new Map<string, Map<string, string>>([
  ["compiler/tsconfigExtendsPackageJsonExportsWildcard.ts", new Map([["foo/strict.json", "/node_modules/foo/configs/strict.json"]])],
]);
const platforms: [string, Platform, boolean][] = [
  ["linux", { os: "linux", caseSensitive: true }, true],
  ["darwin", { os: "darwin", caseSensitive: false }, true],
  ["win32 with the right to make links", { os: "win32", caseSensitive: false }, true],
  ["win32 without the right to make links", { os: "win32", caseSensitive: false }, false],
];
type Count = [number, number, number, number];
const totals = new Map<string, Count>();
const byReason = new Map<string, Count>();
const bump = (m: Map<string, Count>, k: string, i: { run: boolean; kind: string }) => {
  const c = m.get(k) ?? [0, 0, 0, 0];
  c[0]++;
  if (i.run) c[1]++;
  if (i.run && i.kind === "E") c[2]++;
  if (i.run && i.kind === "C") c[3]++;
  m.set(k, c);
};
const lines: string[] = ["suite\tname\tstatus\tkind\tplatform\tcheck\treasons"];
let n = 0;
for (const suite of ["compiler", "conformance"] as const) {
  for (const filename of enumerateFiles(casesRoot + "/" + suite, true)) {
    const basename = getBaseFileName(filename);
    if (skippedTests.includes(basename)) continue;
    const read = readFile(filename);
    const test = getCompilerFileBasedTest(read.contents);
    const configs = test.configurations.length > 0 ? test.configurations : [undefined];
    for (const config of configs) {
      n++;
      const name = getConfiguredName(basename, config?.name ?? "");
      const i = info.get(suite + "/" + name)!;
      const r = newCompilerTest(read.contents, filename, config === undefined ? undefined : new Map(config.config), resolutions.get(suite + "/" + basename));
      if (!r.ok) throw new Error(name + ": " + r.reason);
      for (const [pname, platform, links] of platforms) {
        for (const disk of [false, true]) {
          const check = disk ? "reads absolute names of the texts from the disk" : "writer only";
          const reasons = new Set(findObstacles(r.value, platform, 60, disk).map(o => o.reason as string));
          if (!links && [...r.value.symlinks.values()].some(t => [...r.value.toBeCompiled, ...r.value.otherFiles].some(f => f.unitName === t))) reasons.add("link-not-permitted");
          if (reasons.size === 0) continue;
          bump(totals, pname + " | " + check, i);
          for (const x of reasons) bump(byReason, pname + " | " + check + " | " + x, i);
          if (disk) lines.push([suite, name, i.run ? "run" : "skipped", i.kind, pname, check, [...reasons].sort().join(",")].join("\t"));
        }
      }
    }
  }
}
console.log("instances", n, "columns: all, run, run with an error baseline, run without");
for (const [k, v] of totals) {
  console.log(k.padEnd(92), v.join(" "));
  for (const [k2, v2] of byReason) if (k2.startsWith(k + " | ")) console.log("    " + k2.slice(k.length + 3).padEnd(88), v2.join(" "));
}
writeFileSync(process.argv[3] ?? import.meta.dir + "/../vectors/not-materialisable.tsv", lines.join("\n") + "\n");
