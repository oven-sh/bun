// Classes of difference between a port and one run of Go.
import { readFileSync } from "node:fs";
const runner = process.argv[2];
const vectors = JSON.parse(readFileSync(process.argv[3], "utf8")) as any[];
const truth = readFileSync(process.argv[4], "utf8").split("\n").filter(l => l !== "");
const { MemFs, MemFsPanic } = await import(runner + "/vfstest.ts");
const { decodeBytes } = await import(runner + "/vfs.ts");
const { utf8String, utf8Bytes } = await import(runner + "/gostrings.ts");
const classes = new Map<string, number>();
const examples = new Map<string, string>();
const bump = (k: string, ex: string) => { classes.set(k, (classes.get(k) ?? 0) + 1); if (!examples.has(k)) examples.set(k, ex); };
const norm = (x: any) => JSON.stringify(x);
for (let i = 0; i < vectors.length; i++) {
  const v = vectors[i];
  const want = JSON.parse(truth[i]);
  if (want.crash) continue;
  const input = new Map<string, any>();
  for (const f of v.files) input.set(f, { kind: "file", data: utf8Bytes(f) });
  for (const [link, target] of Object.entries(v.symlinks)) input.set(link, { kind: "symlink", target });
  let fs: any;
  let panic: string | undefined;
  try { fs = new MemFs(input, v.ucsfn); } catch (e) { if (!(e instanceof MemFsPanic)) throw e; panic = (e as Error).message; }
  if (Boolean(want.panic) !== (panic !== undefined)) { bump("construction: one panics", v.name); continue; }
  if (want.panic) { if (want.panic !== panic) bump("construction: panic text: " + want.panic.replace(/"[^"]*"/g, "Q").slice(0, 90), v.name + " port: " + panic); continue; }
  for (let k = 0; k < v.probes.length; k++) {
    const p = v.probes[k];
    const w = want.probes[k];
    const g: any = { path: p, fileExists: false, dirExists: false, readOk: false, contents: "", realpath: "", files: [], directories: [], symlinks: [] };
    try {
      g.fileExists = fs.fileExists(p); g.dirExists = fs.directoryExists(p);
      const b = fs.readFile(p); g.readOk = b !== undefined; g.contents = b === undefined ? "" : utf8String(decodeBytes(b));
      g.realpath = fs.realpath(p);
      const e = fs.getAccessibleEntries(p); g.files = e.files; g.directories = e.directories; g.symlinks = [...e.symlinks].sort();
    } catch (e) { if (!(e instanceof MemFsPanic)) throw e; g.panic = (e as Error).message; }
    if (w.panic && !g.panic) bump("probe: Go panics, the port does not: " + w.panic.replace(/"[^"]*"/g, "Q").replace(/sub \/\/\S+:/, "sub //X:"), v.name + " " + p);
    else if (!w.panic && g.panic) bump("probe: the port panics, Go does not", v.name + " " + p);
    else if (w.panic) { if (w.panic !== g.panic) bump("probe: panic text", v.name + " " + p + " go: " + w.panic + " port: " + g.panic); }
    else for (const f of ["fileExists", "dirExists", "readOk", "contents", "realpath", "files", "directories", "symlinks"]) if (norm(w[f]) !== norm(g[f])) bump("probe field " + f, v.name + " " + p);
  }
}
for (const [k, n] of [...classes].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(6), k, "   e.g.", examples.get(k)!.slice(0, 200));
