// Bytes of the error baselines by oracle class, for the layout decision of the corpus (research probe).
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { enumerateInstances, type Instance } from "./compiler_runner";
const tsgo = "/workspace/ref/typescript-go/testdata/baselines/reference";
const ts = "/workspace/ref/typescript-go/_submodules/TypeScript/tests";
const e = enumerateInstances({ casesRoot: ts + "/cases" });
const stem = (i: Instance) => i.name.replace(/\.tsx?$/, "");
const sum: Record<string, { n: number; bytes: number }> = {};
const add = (k: string, b: number) => { (sum[k] ??= { n: 0, bytes: 0 }).n++; sum[k].bytes += b; };
const instStems = new Set(e.instances.map(stem));
for (const i of e.instances) {
  const a = `${tsgo}/submodule/${i.suite}/${stem(i)}.errors.txt`;
  const b = `${ts}/baselines/reference/${stem(i)}.errors.txt`;
  const ha = existsSync(a), hb = existsSync(b);
  if (hb) add(`TypeScript errors.txt of ${i.status} instances`, statSync(b).size);
  if (ha) add("typescript-go errors.txt (all, run instances)", statSync(a).size);
  if (ha && (!hb || readFileSync(a, "latin1") !== readFileSync(b, "latin1"))) add("typescript-go errors.txt that differ in bytes or have no TypeScript file", statSync(a).size);
}
// TypeScript error baselines that belong to no enumerated instance (other suites, the 45 dropped files)
let other = 0, otherBytes = 0, all = 0, allBytes = 0;
for (const f of readdirSync(ts + "/baselines/reference")) {
  if (!f.endsWith(".errors.txt")) continue;
  const s = statSync(`${ts}/baselines/reference/${f}`).size;
  all++; allBytes += s;
  if (!instStems.has(f.slice(0, -11))) { other++; otherBytes += s; }
}
for (const [k, v] of Object.entries(sum)) console.log(k.padEnd(80), String(v.n).padStart(6), (v.bytes / 1e6).toFixed(2) + " MB");
console.log("TypeScript errors.txt in the flat directory".padEnd(80), String(all).padStart(6), (allBytes / 1e6).toFixed(2) + " MB");
console.log("  of them with no enumerated instance".padEnd(80), String(other).padStart(6), (otherBytes / 1e6).toFixed(2) + " MB");
