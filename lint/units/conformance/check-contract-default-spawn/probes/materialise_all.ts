// Materialises every run instance once and reports what the file system refuses (research probe).
import { buildInput } from "../prototype/run";
import { readdirSync, lstatSync, readFileSync, mkdirSync } from "node:fs";
const P = new URL("../../enumerator/prototype/", import.meta.url).pathname;
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { readFile } = await import(P + "vfs.ts");
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot });
const seen = new Set<string>();
const problems: Record<string, string[]> = {};
let done = 0, files = 0, links = 0, overwritten = 0;
const t0 = performance.now();
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const key = i.casePath + "|" + (i.config?.get("currentdirectory") ?? "") + "|" + (i.config?.get("noimplicitreferences") ?? "");
  if (seen.has(key)) continue;
  seen.add(key);
  const file = casesRoot + "/" + i.casePath;
  const input = buildInput(i, readFile(file).contents, file);
  if (typeof input === "string") continue;
  try {
    const m = input.materialise();
    done++;
    const all = [...input.roots, ...input.otherFiles];
    files += all.length;
    links += input.links.size;
    const last = new Map<string, string>();
    for (const u of all) { if (last.has(u.name)) overwritten++; last.set(u.name, u.content); }
    for (const [name, content] of last) {
      const back = readFileSync(m.toReal(name), "utf8");
      if (back !== content) (problems["content read back differs"] ??= []).push(i.name + ": " + name);
    }
  } catch (err: any) {
    const reason = String(err?.code ?? err?.message ?? err).slice(0, 60);
    (problems[reason] ??= []).push(i.name + ": " + String(err?.message ?? err).slice(0, 160));
  } finally {
    input.dispose();
  }
}
console.log(JSON.stringify({ materialised: done, files, links, overwritten, ms: Math.round(performance.now() - t0) }));
for (const [k, v] of Object.entries(problems)) console.log(`\n${k} (${v.length})\n  ` + v.slice(0, 12).join("\n  "));
