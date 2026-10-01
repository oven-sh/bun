// Replay with positions in UTF-16 code units: the conversion of the pipeline must give the same bytes (research probe).
import { buildInput, readOracle, replayCheck, runInstance, testLibFile } from "./run";
import type { Check, CheckDiagnostic } from "./check";
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { readFile } = await import(P + "vfs.ts");
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const baselines = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const e = enumerateInstances({ casesRoot });
const oracles = new Map<string, string | undefined>();
const inner = replayCheck(n => oracles.get(n));
const utf16Of = (source: string, utf8: number) => Buffer.from(source, "utf8").subarray(0, utf8).toString("utf8").length;
const check: Check = {
  name: "replay-utf16",
  level: "baseline",
  async check(input) {
    const r = await inner.check(input);
    if (r.kind !== "diagnostics") return r;
    const text = new Map<string, string>();
    for (const f of [...input.roots, ...input.otherFiles]) text.set(f.name, f.content);
    let nonAscii = false;
    const conv = <T extends { file: string | undefined; start: number; length: number }>(d: T): T => {
      if (d.file === undefined) return d;
      const source = text.get(d.file) ?? testLibFile(d.file);
      if (source === undefined) return d;
      const start = utf16Of(source, d.start);
      const end = utf16Of(source, d.start + d.length);
      if (start !== d.start) nonAscii = true;
      return { ...d, start, length: end - start };
    };
    const diagnostics = r.diagnostics.map(d => ({ ...conv(d), relatedInformation: d.relatedInformation.map(conv) })) as CheckDiagnostic[];
    if (nonAscii) moved++;
    return { ...r, positions: "utf16", diagnostics };
  },
};
let moved = 0;
const counts: Record<string, number> = {};
const bad: string[] = [];
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const file = casesRoot + "/" + i.casePath;
  const input = buildInput(i, readFile(file).contents, file);
  if (typeof input === "string") continue;
  const oracle = readOracle(baselines, i);
  if (oracle === undefined) continue;
  oracles.set(i.name, oracle);
  const r = await runInstance(input, check, oracle, (i.config?.get("pretty") ?? "").toLowerCase() === "true");
  counts[r.status] = (counts[r.status] ?? 0) + 1;
  if (r.status !== "pass") bad.push(i.name + ": " + r.detail.slice(0, 200));
}
console.log(JSON.stringify(counts), "instances where an offset differs between the two units:", moved);
console.log(bad.slice(0, 10).join("\n"));
