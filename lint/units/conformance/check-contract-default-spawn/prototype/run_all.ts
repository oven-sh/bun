// Runs the replay checks and the empty check over every run instance and prints the counts (research probe).
import { buildInput, emptyCheck, readOracle, replayCheck, replayPlainCheck, runInstance } from "./run";
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { readFile } = await import(P + "vfs.ts");
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const baselines = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const e = enumerateInstances({ casesRoot });
const oracles = new Map<string, string | undefined>();
const checks = [replayCheck(n => oracles.get(n)), replayPlainCheck(n => oracles.get(n)), emptyCheck("baseline"), emptyCheck("first-section")];
const counts: Record<string, number> = {};
const details: Record<string, string[]> = {};
let notBuilt = 0;
const t0 = performance.now();
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const file = casesRoot + "/" + i.casePath;
  const input = buildInput(i, readFile(file).contents, file);
  if (typeof input === "string") { notBuilt++; counts["not built: " + input] = (counts["not built: " + input] ?? 0) + 1; continue; }
  const oracle = readOracle(baselines, i);
  oracles.set(i.name, oracle);
  const pretty = (i.config?.get("pretty") ?? "").toLowerCase() === "true";
  for (const check of checks) {
    const r = await runInstance(input, check, oracle, pretty);
    const key = `${check.name} (${check.level}) ${r.kind} ${r.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (r.status !== "pass" && check.name.startsWith("replay")) (details[key] ??= []).push(i.name + ": " + r.detail.slice(0, 300));
    if (r.status === "pass" && check.name === "empty" && r.kind === "E") (details[key] ??= []).push(i.name);
  }
  input.dispose();
}
console.log("ms", Math.round(performance.now() - t0));
for (const k of Object.keys(counts).sort()) console.log(String(counts[k]).padStart(6), k);
for (const [k, v] of Object.entries(details)) console.log("\n" + k + "\n  " + v.slice(0, 15).join("\n  "));
