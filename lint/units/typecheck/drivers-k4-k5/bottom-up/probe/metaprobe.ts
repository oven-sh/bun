// Research probe: package.json type, package directory and implied node format of every non-lib program file,
// computed from the in-memory files of the instance with the rule of fileloader.go 370-391, against typescript-go's manifest.
// usage: bun metaprobe.ts <manifest.jsonl>
import { readFileSync } from "node:fs";
import ts from "typescript";
import { enumerateCase, inputOf, listCases, referenceLayout } from "/workspace/notes/lint/units/conformance/test-file-and-sweep/top-down/index.ts";
const manifest = new Map<string, any>();
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) { if (line === "") continue; const r = JSON.parse(line); manifest.set(r.suite + "/" + r.name, r); }
const layout = referenceLayout();
const count = new Map<string, number>(); const bump = (k: string, n = 1) => count.set(k, (count.get(k) ?? 0) + n);
const ends = (f: string, exts: string[]) => exts.some(e => f.toLowerCase().endsWith(e));
function implied(path: string, type: string): number {
  if (ends(path, [".d.mts", ".mts", ".mjs"])) return 99;
  if (ends(path, [".d.cts", ".cts", ".cjs"])) return 1;
  if (ends(path, [".d.ts", ".ts", ".tsx", ".js", ".jsx"])) return type === "module" ? 99 : 1;
  return 0;
}
const examples: string[] = [];
for (const casePath of listCases(layout.casesRoot)) for (const inst of enumerateCase(layout.casesRoot, casePath)) {
  if (inst.status !== "run") continue;
  const m = manifest.get(inst.suite + "/" + inst.name); if (!m) continue;
  const r = inputOf(inst, { layout }); if (!r.ok) continue;
  const i = r.input;
  const files = new Map<string, string>();
  for (const f of [...i.roots, ...i.otherFiles]) files.set(i.useCaseSensitiveFileNames ? f.name : f.name.toLowerCase(), f.content);
  const res = m.options.moduleResolution;
  let bad = 0;
  for (const f of m.files ?? []) {
    let dir = f.n.slice(0, f.n.lastIndexOf("/"));
    let type = "", pdir = "", strict = true;
    for (;;) {
      const key = (dir === "" ? "" : dir) + "/package.json";
      const text = files.get(i.useCaseSensitiveFileNames ? key : key.toLowerCase());
      if (text !== undefined) {
        pdir = dir === "" ? "/" : dir;
        let json: any;
        try { json = JSON.parse(text); } catch { strict = false; json = ts.parseConfigFileTextToJson(key, text).config; }
        const t = json?.type;
        if (typeof t === "string") {
          if ((!ends(f.n, [".mts", ".cts", ".mjs", ".cjs"]) && res >= 3 && res <= 99) || f.n.includes("/node_modules/")) type = t;
        }
        break;
      }
      if (dir === "" || dir === "/") break;
      dir = dir.slice(0, dir.lastIndexOf("/"));
    }
    const fmt = implied(f.n, type);
    const ok = (f.pjt ?? "") === type && (f.pjd ?? "") === pdir && f.fmt === fmt;
    bump("files"); if (!ok) { bad++; bump("files that differ" + (strict ? "" : " (package.json is no strict JSON)")); if (examples.length < 12) examples.push(`${inst.suite}/${inst.name} ${f.n}: go type=${f.pjt ?? ""} dir=${f.pjd ?? ""} fmt=${f.fmt}; rule type=${type} dir=${pdir} fmt=${fmt}`); }
    if (pdir !== "") bump("files below a package.json");
  }
  bump(bad === 0 ? "instances equal" : "instances that differ");
}
for (const [k, v] of [...count].sort()) console.log(String(v).padStart(7), k);
console.log(examples.join("\n"));
