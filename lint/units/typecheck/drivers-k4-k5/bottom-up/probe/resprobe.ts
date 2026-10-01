// Research probe: module resolutions of typescript 6.0.2 over the in-memory files of an instance, against the
// resolutions that typescript-go recorded for the same instance (manifest of groundtruth/k5).
// usage: bun resprobe.ts <manifest.jsonl> <out.tsv>
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { enumerateCase, inputOf, listCases, referenceLayout } from "/workspace/notes/lint/units/conformance/test-file-and-sweep/top-down/index.ts";

const manifest = new Map<string, any>();
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (line === "") continue;
  const r = JSON.parse(line);
  manifest.set(r.suite + "/" + r.name, r);
}
const layout = referenceLayout();
const libRoot = layout.libRoot;
const testLib = new Map<string, string>();
for (const rel of ["react.d.ts", "react16.d.ts", "react18/react18.d.ts", "react18/global.d.ts"]) {
  try { testLib.set("/.lib/" + rel, readFileSync(libRoot + "/" + rel, "utf8")); } catch {}
}
const count = new Map<string, number>();
const bump = (k: string, n = 1) => count.set(k, (count.get(k) ?? 0) + n);
const rows: string[] = [];
let instances = 0;
for (const casePath of listCases(layout.casesRoot)) {
  for (const inst of enumerateCase(layout.casesRoot, casePath)) {
    if (inst.status !== "run") continue;
    const m = manifest.get(inst.suite + "/" + inst.name);
    if (m === undefined) { bump("no manifest row"); continue; }
    const mfiles = [...(m.files ?? []), ...(m.libfiles ?? [])];
    const wanted = mfiles.filter((f: any) => (f.res ?? []).length > 0 || (f.typelist ?? []).length > 0);
    if (wanted.length === 0 && (m.autotypes ?? []).length === 0) { bump("instances without a name to resolve"); continue; }
    const r = inputOf(inst, { layout });
    if (!r.ok) { bump("input not ok"); continue; }
    const i = r.input;
    instances++;
    const files = new Map<string, string>();
    for (const f of [...i.roots, ...i.otherFiles]) files.set(f.name, f.content);
    if (i.configFile) files.set(i.configFile.name, i.configFile.content);
    if (i.includeLibDirectory) for (const [k, v] of testLib) files.set(k, v);
    const ucs = i.useCaseSensitiveFileNames;
    const canon = (s: string) => (ucs ? s : s.toLowerCase());
    const byCanon = new Map<string, string>();
    const dirs = new Set<string>();
    for (const name of files.keys()) {
      byCanon.set(canon(name), name);
      let d = name;
      for (;;) { const k = d.lastIndexOf("/"); if (k <= 0) { dirs.add("/"); break; } d = d.slice(0, k); dirs.add(canon(d)); }
    }
    const host: ts.ModuleResolutionHost = {
      fileExists: f => byCanon.has(canon(f)),
      readFile: f => { const n = byCanon.get(canon(f)); return n === undefined ? undefined : files.get(n); },
      directoryExists: d => dirs.has(canon(d.replace(/\/$/, "")) || "/"),
      getCurrentDirectory: () => i.currentDirectory,
      realpath: f => f,
      useCaseSensitiveFileNames: ucs,
      getDirectories: d => { const p = canon(d.replace(/\/$/, "")) + "/"; const out = new Set<string>(); for (const x of dirs) if (x.startsWith(p) && !x.slice(p.length).includes("/") && x.length > p.length) out.add(x.slice(p.length)); return [...out]; },
    };
    const o: any = { ...(m.opts ?? {}) };
    o.module = m.options.module; o.moduleResolution = m.options.moduleResolution; o.target = m.options.target;
    delete o.newLine; delete o.lib;
    if (o.jsx === 2) o.jsx = 3; else if (o.jsx === 3) o.jsx = 2;
    const flags: string[] = [];
    if (i.links.length > 0) flags.push("links");
    if (i.configFile) flags.push("tsconfig");
    if (!ucs) flags.push("nocase");
    let bad = 0, total = 0;
    const details: string[] = [];
    for (const f of wanted) {
      for (const e of f.res ?? []) {
        total++;
        const [name, mode] = e;
        const want = e.length > 2 ? e[2] : "";
        let got = "", gotExt = false, gotPkg = "";
        try {
          const res = ts.resolveModuleName(name, f.n, o, host, undefined, undefined, mode === 0 ? undefined : mode).resolvedModule;
          got = res?.resolvedFileName ?? ""; gotExt = !!res?.isExternalLibraryImport; gotPkg = res?.packageId?.name ?? "";
        } catch (err) { got = "THROW " + String(err).slice(0, 80); }
        const wantExt = e.length > 4 ? !!e[4] : false;
        const wantPkg = e.length > 5 ? e[5] : "";
        if (got !== want) { bad++; details.push(`mod ${f.n} ${JSON.stringify(name)} mode ${mode}: go ${want || "-"} ts ${got || "-"}`); bump(want === "" ? "ts resolves, go does not" : got === "" ? "go resolves, ts does not" : "both resolve, to different files"); }
        else if (want !== "" && (gotExt !== wantExt)) { bad++; details.push(`ext ${f.n} ${JSON.stringify(name)}: go ${wantExt} ts ${gotExt}`); bump("isExternalLibraryImport differs"); }
        else if (want !== "" && gotPkg !== wantPkg) { bump("packageId name differs (not counted)"); }
      }
      for (const e of f.typelist ?? []) {
        total++;
        const [name, mode, want] = e;
        let got = "";
        try {
          const res = ts.resolveTypeReferenceDirective(name, f.n, o, host, undefined, undefined, mode === 0 ? undefined : mode).resolvedTypeReferenceDirective;
          got = res?.resolvedFileName ?? "";
        } catch (err) { got = "THROW " + String(err).slice(0, 80); }
        if (got !== (want || "")) { bad++; details.push(`type ${f.n} ${JSON.stringify(name)}: go ${want || "-"} ts ${got || "-"}`); bump("type reference differs"); }
      }
    }
    bump("names resolved", total);
    bump(bad === 0 ? "instances equal" : "instances that differ");
    if (flags.length > 0) bump((bad === 0 ? "equal" : "differ") + " with " + flags.join("+"));
    rows.push([inst.suite, inst.name, total, bad, flags.join(","), mfiles.length, details.slice(0, 3).join(" | ")].join("\t"));
  }
}
writeFileSync(process.argv[3], rows.join("\n") + "\n");
console.log("instances with a name to resolve", instances);
for (const [k, v] of [...count].sort()) console.log(String(v).padStart(7), k);
console.log("typescript", ts.version);
