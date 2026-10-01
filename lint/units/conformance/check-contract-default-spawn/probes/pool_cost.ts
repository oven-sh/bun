// Cost of one process per instance: materialise, spawn the stand-in command, read stderr, remove the directory (research probe).
import { join } from "node:path";
import { createSpawnCheck } from "../prototype/check";
import { buildInput } from "../prototype/run";
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { readFile } = await import(P + "vfs.ts");
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const env = { ...process.env, NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1" } as Record<string, string | undefined>;
const check = createSpawnCheck({ command: [process.execPath, join(import.meta.dir, "../prototype/fixtures/fake-lint.ts")], env }, () => undefined);
const e = enumerateInstances({ casesRoot, only: "conformance/types" });
const build = () => {
  const inputs = [];
  for (const i of e.instances) {
    if (i.status !== "run" || inputs.length >= Number(process.argv[2] ?? 400)) continue;
    const file = casesRoot + "/" + i.casePath;
    const input = buildInput(i, readFile(file).contents, file);
    if (typeof input !== "string") inputs.push(input);
  }
  return inputs;
};
for (const width of [16, 4, 1]) {
  const inputs = build();
  const t0 = performance.now();
  let next = 0;
  const kinds: Record<string, number> = {};
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < inputs.length) {
        const input = inputs[next++];
        const r = await check.check(input);
        const k = r.kind === "failure" ? r.failure : r.kind;
        kinds[k] = (kinds[k] ?? 0) + 1;
        input.dispose();
      }
    }),
  );
  const ms = performance.now() - t0;
  console.log(`width ${width}: ${inputs.length} instances in ${Math.round(ms)} ms, ${(ms / inputs.length).toFixed(1)} ms each`, JSON.stringify(kinds));
}
