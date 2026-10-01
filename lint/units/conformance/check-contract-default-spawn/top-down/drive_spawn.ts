// Research prototype: real instances of one directory through the check that spawns, with the command that stands for a linter.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createSpawnCheck } from "./check";
import { createManifestCheck } from "./manifest";
import { buildInputs, oracleOf } from "./inputs";
import { runInstances } from "./run";

const only = process.argv[2] ?? "conformance/types/tuple";
const protocol = process.argv[3] ?? "operands";
const below = "/tmp/ccds-spawn-mat";
rmSync(below, { recursive: true, force: true });
const built = buildInputs({ only, materialiseBelow: below });
const command = [process.execPath, join(import.meta.dir, "fakes", "lints.ts")];
const env = { ...process.env } as Record<string, string | undefined>;
const check = protocol === "manifest" ? createManifestCheck({ command, env, directory: below + "/manifests", batchSize: 64 }) : createSpawnCheck({ command, env });
const t0 = performance.now();
const results = await runInstances(built.inputs, check, { oracle: oracleOf, concurrency: 8, timeoutMs: 60_000, loose: true });
const ms = performance.now() - t0;
const count: Record<string, number> = {};
for (const r of results) {
  const key = `${r.kind} ${r.status}${r.level !== undefined ? " at " + r.level : ""}${r.loose !== undefined ? (r.loose.equal ? ", loose equal" : ", loose differs") : ""}`;
  count[key] = (count[key] ?? 0) + 1;
}
console.log(`${only}: ${built.inputs.length} instances, ${protocol}, ${Math.round(ms)} ms, ${(ms / built.inputs.length).toFixed(1)} ms each`);
console.log(JSON.stringify(count));
const reasons: Record<string, number> = {};
for (const r of results) if (r.status !== "pass") reasons[r.reason.replace(/\d+/g, "n").slice(0, 80)] = (reasons[r.reason.replace(/\d+/g, "n").slice(0, 80)] ?? 0) + 1;
console.log(Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 6));
const f = results.find(r => r.status === "fail" && r.diff !== undefined);
if (f) console.log(f.suite + "/" + f.name, f.reason, "\n" + f.diff!.split("\n").slice(0, 12).join("\n"));
rmSync(below, { recursive: true, force: true });
