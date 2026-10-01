// The chosen materialisation modules, as assembled, against the dump that the other pass took from the reference's own packages.
// usage: bun cross_roots.ts <assembled tree> [notes of the unit] [typescript-go checkout]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const asm = process.argv[2];
const notes = process.argv[3] ?? "/workspace/notes/lint/units/conformance";
const ref = process.argv[4] ?? "/workspace/ref/typescript-go";
const r = await import(asm + "/test/cli/lint/conformance/runner/index.ts");
const truth = new Map<string, any>();
for (const l of gunzipSync(readFileSync(notes + "/instance-materialisation/top-down/vectors/roots.jsonl.gz")).toString("utf8").split("\n")) {
  if (l === "") continue;
  const t = JSON.parse(l);
  truth.set(t.suite + "/" + t.name, t);
}
const layout = r.referenceLayout(ref);
const e = r.enumerateInstances({ casesRoot: layout.casesRoot });
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
const c: Record<string, number> = { instances: 0, inDump: 0, built: 0, same: 0, entriesSame: 0, entriesNotComparedForTheLibDirectory: 0, files: 0 };
function fnv(b: Uint8Array): string {
  let h = 14695981039346656037n;
  for (const x of b) {
    h ^= BigInt(x);
    h = (h * 1099511628211n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
const byField: Record<string, number> = {};
const notBuilt: Record<string, number> = {};
const shown: string[] = [];
for (const inst of e.instances) {
  c.instances++;
  const t = truth.get(inst.suite + "/" + inst.name);
  if (t === undefined) continue;
  c.inDump++;
  const built = r.inputOf(inst, { layout });
  if (!built.ok) {
    const k = built.status + (t.stop ?? t.vfsPanic ? " (the reference stops too)" : "");
    notBuilt[k] = (notBuilt[k] ?? 0) + 1;
    continue;
  }
  if (t.stop !== undefined || t.vfsPanic !== undefined) {
    notBuilt["the reference stops and the port does not"] = (notBuilt["the reference stops and the port does not"] ?? 0) + 1;
    continue;
  }
  c.built++;
  const i = built.input;
  const mine: Record<string, unknown> = {
    currentDirectory: i.currentDirectory,
    configFiles: i.configFile === undefined ? [] : [i.configFile.name],
    roots: i.roots.map((f: any) => f.name),
    otherFiles: i.otherFiles.map((f: any) => f.name),
    programFileNames: i.rootNames,
    includeLibDir: i.includeLibDirectory,
    useCaseSensitiveFileNames: i.useCaseSensitiveFileNames,
    symlinks: sorted(Object.fromEntries(i.links.map((l: any) => [l.path, l.target]))),
  };
  const theirs: Record<string, unknown> = {
    currentDirectory: t.currentDirectory,
    configFiles: t.configFiles,
    roots: t.roots,
    otherFiles: t.otherFiles,
    programFileNames: t.programFileNames,
    includeLibDir: t.includeLibDir,
    useCaseSensitiveFileNames: t.useCaseSensitiveFileNames,
    symlinks: sorted(t.symlinks),
  };
  let ok = true;
  for (const k of Object.keys(mine)) {
    if (!eq(mine[k], theirs[k])) {
      ok = false;
      byField[k] = (byField[k] ?? 0) + 1;
      if (shown.length < 12) shown.push(`${inst.suite}/${inst.name} (${inst.status}): ${k}: port ${JSON.stringify(mine[k])?.slice(0, 200)} reference ${JSON.stringify(theirs[k])?.slice(0, 200)}`);
    }
  }
  // The bytes of every file of the virtual disk: a later file of the same name replaces an earlier one, a link replaces a file.
  const disk = new Map<string, Uint8Array>();
  for (const f of [...i.roots, ...i.otherFiles]) disk.set(f.name, Buffer.from(f.content, "utf8"));
  for (const l of i.links) disk.delete(l.path);
  const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const mineEntries = [...disk].map(([path, b]) => ({ path, size: b.length, sha: fnv(b) })).sort(byPath);
  const theirEntries = (t.entries as any[]).filter(x => x.length === 3).map(x => ({ path: x[0], size: x[1], sha: x[2] })).sort(byPath);
  if (!eq(mineEntries, theirEntries)) {
    // A file below /.lib gives way to the file of tests/lib when that directory is mounted; the dump leaves those out.
    if (i.includeLibDirectory && mineEntries.some(x => x.path.startsWith("/.lib/"))) c.entriesNotComparedForTheLibDirectory++;
    else {
      ok = false;
      byField.entries = (byField.entries ?? 0) + 1;
      if (shown.length < 12) shown.push(`${inst.suite}/${inst.name}: entries: port ${JSON.stringify(mineEntries).slice(0, 200)} reference ${JSON.stringify(theirEntries).slice(0, 200)}`);
    }
  } else c.entriesSame++;
  c.files += mineEntries.length;
  if (ok) c.same++;
}
console.log(JSON.stringify({ ...c, byField, notBuilt }));
for (const s of shown) console.log("  " + s);
