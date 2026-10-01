// Probe: cost of the basic operations of the test file, for a release build and for a debug build.
// usage: <bun> cost_basics.ts
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const cases = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const notes = new URL("../../../", import.meta.url).pathname;
const out: Record<string, number | string> = { version: Bun.version };
const cpuMs = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1000; };
const time = <T>(label: string, f: () => T): T => {
  const t = performance.now();
  const c = cpuMs();
  const v = f();
  out[label] = `wall ${(performance.now() - t).toFixed(1)} ms, cpu ${(cpuMs() - c).toFixed(1)} ms`;
  return v;
};
const walk = (dir: string, withTypes: boolean): string[] => {
  const files: string[] = [];
  const go = (d: string) => {
    if (withTypes) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) go(d + "/" + e.name);
        else files.push(d + "/" + e.name);
      }
    } else {
      for (const name of readdirSync(d)) {
        if (/\.[a-z]+$/.test(name)) files.push(d + "/" + name);
        else go(d + "/" + name);
      }
    }
  };
  go(dir);
  return files;
};
const a = time("walk with Dirent (compiler+conformance)", () => [...walk(cases + "/compiler", true), ...walk(cases + "/conformance", true)]);
out.files = a.length;
time("readdirSync recursive x2", () => readdirSync(cases + "/compiler", { recursive: true }).length + readdirSync(cases + "/conformance", { recursive: true }).length);
time("Bun.Glob **/*.{ts,tsx} scanSync x2", () => [...new Bun.Glob("**/*.{ts,tsx}").scanSync(cases + "/compiler")].length + [...new Bun.Glob("**/*.{ts,tsx}").scanSync(cases + "/conformance")].length);
const sorted = time("sort 12444 paths", () => a.slice().sort());
const sample = sorted.filter((_, k) => k % 40 === 0);
out.sample = sample.length;
const texts = time(`readFileSync utf8 x${sample.length}`, () => sample.map(f => readFileSync(f, "utf8")));
time(`readFileSync bytes x${sample.length}`, () => sample.map(f => readFileSync(f)).length);
const optionRegex = /(?<![^\n])\/{2}[\t\n\f\r ]*@(\w+)[\t\n\f\r ]*:[\t\n\f\r ]*([^\r\n]*)/g;
time(`settings regex x${sample.length}`, () => texts.map(t => [...t.matchAll(optionRegex)].length));
time(`split lines x${sample.length}`, () => texts.map(t => t.split(/\r?\n/).length));
const gz = readFileSync(notes + "enumerator/vectors/instances.tsv.gz");
const tsv = time("gunzip instances.tsv.gz (1.85 MB)", () => Buffer.from(Bun.gunzipSync(gz)).toString("utf8"));
const rows = time("split 14916 lines x 8 fields", () => tsv.split("\n").map(l => l.split("\t")));
out.rows = rows.length;
time("Map of 14915 names", () => new Map(rows.map(r => [r[0], r])).size);
const json = JSON.stringify(rows);
time(`JSON.parse ${json.length} chars`, () => JSON.parse(json).length);
time("JSON.stringify same", () => JSON.stringify(rows).length);
const dir = mkdtempSync(join(tmpdir(), "tfs-cost-"));
time("write 100 instance directories of 2 files", () => {
  for (let k = 0; k < 100; k++) {
    mkdirSync(`${dir}/${k}/.src`, { recursive: true });
    writeFileSync(`${dir}/${k}/.src/a.ts`, texts[k % texts.length]);
    writeFileSync(`${dir}/${k}/.src/b.ts`, texts[(k + 1) % texts.length]);
  }
});
time("rm -r of them", () => rmSync(dir, { recursive: true, force: true }));
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } as Record<string, string>;
let childCpu = 0;
const one = async () => {
  const p = Bun.spawn({ cmd: [process.execPath, "--version"], env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  childCpu += Number(p.resourceUsage()?.cpuTime.total ?? 0) / 1000;
};
let t = performance.now();
for (let k = 0; k < 5; k++) await one();
out["spawn --version, each of 5 in sequence"] = `wall ${Math.round((performance.now() - t) / 5)} ms, child cpu ${(childCpu / 5).toFixed(1)} ms`;
childCpu = 0;
t = performance.now();
await Promise.all(Array.from({ length: 8 }, one));
out["spawn --version, 8 at once, total"] = `wall ${Math.round(performance.now() - t)} ms, child cpu each ${(childCpu / 8).toFixed(1)} ms`;
childCpu = 0;
t = performance.now();
await Promise.all(Array.from({ length: 32 }, one));
out["spawn --version, 32 at once, total"] = `wall ${Math.round(performance.now() - t)} ms, child cpu each ${(childCpu / 32).toFixed(1)} ms`;
console.log(JSON.stringify(out, null, 1));
