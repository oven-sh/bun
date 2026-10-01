import { buildInputs } from "./inputs";
import { rmSync } from "node:fs";
const below = "/tmp/ccds-mat";
rmSync(below, { recursive: true, force: true });
const built = buildInputs({ materialiseBelow: below });
const c: Record<string, number> = {};
const ex: Record<string, string[]> = {};
const t0 = performance.now();
let files = 0;
for (const i of built.inputs) {
  const m = i.materialise();
  const k = m.ok ? "ok" : m.status;
  c[k] = (c[k] ?? 0) + 1;
  if (!m.ok) (ex[k] ??= []).push(i.suite + "/" + i.name);
  files += i.roots.length + i.otherFiles.length + (i.configFile ? 1 : 0);
}
console.log(c, "files", files, "ms", Math.round(performance.now() - t0));
for (const [k, v] of Object.entries(ex)) console.log(k, v.slice(0, 4).join(", "));
rmSync(below, { recursive: true, force: true });
