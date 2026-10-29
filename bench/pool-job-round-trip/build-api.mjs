// Bun.build() through the JS API uses the runtime's work pool. Bundles a generated project several times.
//   bun build-api.mjs [modules=2000] [rounds=5]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const modules = +(process.argv[2] || 2000);
const rounds = +(process.argv[3] || 5);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-api-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
for (let i = 0; i < modules; i++) {
  const imports = [];
  for (const j of [i * 2 + 1, i * 2 + 2]) if (j < modules) imports.push(`import { f${j} } from "./m${j}.ts";`);
  const calls = imports.length ? [i * 2 + 1, i * 2 + 2].filter(j => j < modules).map(j => `f${j}(n)`).join(" + ") : "0";
  let body = "";
  for (let k = 0; k < 20; k++) body += `export function g${i}_${k}(a: number, b: string): string { const o = { a, b, k: ${k} }; return JSON.stringify(o) + b.repeat(a % 3); }\n`;
  fs.writeFileSync(path.join(dir, `m${i}.ts`), `${imports.join("\n")}\n${body}export function f${i}(n: number): number { return n + ${i} + ${calls}; }\n`);
}
const times = [];
const cpu0 = process.cpuUsage();
for (let r = 0; r < rounds; r++) {
  const t = performance.now();
  const out = await Bun.build({ entrypoints: [path.join(dir, "m0.ts")], outdir: path.join(dir, "out" + r) });
  if (!out.success) throw new Error("build failed");
  times.push(performance.now() - t);
}
const cpu = process.cpuUsage(cpu0);
times.sort((a, b) => a - b);
console.log(JSON.stringify({ modules, buildMsP50: +times[rounds >> 1].toFixed(1), buildMsMin: +times[0].toFixed(1), cpuMsPerBuild: +((cpu.user + cpu.system) / 1000 / rounds).toFixed(1) }));
