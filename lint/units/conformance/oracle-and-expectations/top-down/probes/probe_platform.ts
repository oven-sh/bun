// Research probe: a rough count of run instances that one of three platforms cannot hold faithfully.
const P = "/workspace/notes/lint/units/conformance/enumerator/prototype/";
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const { makeUnitsFromTest, srcFolder } = await import(P + "test_case_parser.ts");
const { getNormalizedAbsolutePath } = await import(P + "tspath.ts");
const { readFile } = await import(P + "vfs.ts");
import { readFileSync } from "node:fs";
const rows = JSON.parse(readFileSync("/tmp/oe/rows.json", "utf8")) as any[];
const kind = new Map(rows.map(r => [r.name, r.tsgo ? "E" : "C"]));
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot });
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const counts: Record<string, number[]> = {};
const add = (k: string, i: any) => { const c = (counts[k] ??= [0, 0, 0]); c[0]++; if (kind.get(i.name) === "E") c[1]++; else c[2]++; };
let run = 0;
for (const i of e.instances) {
  if (i.status !== "run") continue;
  run++;
  const file = casesRoot + "/" + i.casePath;
  const made = makeUnitsFromTest(readFile(file).contents, file);
  if (!made.ok) { add("units not made", i); continue; }
  const t = made.value;
  const cwd = getNormalizedAbsolutePath(i.config?.get("currentdirectory") ?? "", srcFolder);
  const names: string[] = [cwd];
  for (const u of [...t.testUnitData, ...(t.tsConfigFileUnitData ? [t.tsConfigFileUnitData] : [])]) names.push(getNormalizedAbsolutePath(u.name, cwd));
  const links = [...t.symlinks];
  for (const [l] of links) names.push(getNormalizedAbsolutePath(l, cwd));
  const why = new Set<string>();
  if (names.some(n => /^[a-zA-Z]:/.test(n))) why.add("any: drive root");
  if ((i.config?.get("usecasesensitivefilenames") ?? "true").toLowerCase() === "false") why.add("linux: the instance asks for a disk that ignores case");
  const seen = new Map<string, string>();
  for (const n of names) { let p = ""; for (const s of n.split("/").slice(1)) { p += "/" + s; const o = seen.get(p.toLowerCase()); if (o !== undefined && o !== p) why.add("darwin, win32: names differ only in case"); seen.set(p.toLowerCase(), p); } }
  for (const n of names) for (const s of n.split("/")) if (s !== "" && !/^[a-zA-Z]:$/.test(s) && (/[<>:"|?*\u0000-\u001f\\]/.test(s) || /[. ]$/.test(s) || reserved.test(s))) why.add("win32: name that Windows rejects");
  if (links.length > 0) why.add("win32: links");
  if (names.some(n => n.normalize("NFC") !== n || n.normalize("NFD") !== n)) why.add("darwin: more than one normal form");
  for (const w of why) add(w, i);
  if (why.size > 0) add("limited on at least one platform", i);
}
console.log("run instances", run, "[all, E, C]");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1][0] - a[1][0])) console.log(String(v[0]).padStart(6), String(v[1]).padStart(6), String(v[2]).padStart(6), " ", k);
