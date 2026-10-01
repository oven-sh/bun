// Research probe: the prototype ports against the results of the ground truth program.
import { getFileNamesFromConfigSpecs } from "./config_files";
import { MemFs, MemFsPanic, type MemInput } from "./memfs";
import {
  combinePaths,
  ensureTrailingDirectorySeparator,
  getBaseFileName,
  getDirectoryPath,
  getNormalizedAbsolutePath,
  getRootLength,
  isRootedDiskPath,
  normalizePath,
  removeTrailingDirectorySeparator,
} from "./tspath";
import {
  changeExtension,
  compareStringsCaseInsensitive,
  compareStringsCaseSensitive,
  containsPath,
  convertToRelativePath,
  fileExtensionIs,
  getAnyExtensionFromPathEx,
  getNormalizedPathComponents,
  getPathComponents,
  getPathFromPathComponents,
  hasExtension,
  toPathEx,
} from "./tspath_more";
import { readDirectory, UnlimitedDepth } from "./vfsmatch";

// Usage: bun verify_vectors.ts ../vectors/vectors.json.gz ../vectors/expected.json.gz (plain JSON of the ground truth program works too)
async function load(path: string): Promise<any> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return JSON.parse(new TextDecoder().decode(path.endsWith(".gz") ? Bun.gunzipSync(bytes) : bytes));
}
const vectors = await load(process.argv[2]);
const expected = await load(process.argv[3]);
// the saved form holds each listing once, by hash
if (expected.trees !== undefined) for (const m of expected.match) m.entries = expected.trees[m.entries];

let bad = 0;
let checked = 0;
const byField: Record<string, number> = {};
const show: string[] = [];
function eq(what: string, field: string, got: unknown, want: unknown) {
  checked++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++;
    byField[field] = (byField[field] ?? 0) + 1;
    if (show.length < 60) show.push(`${what} ${field}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}

function guard<T>(f: () => T): { value?: T; panic: string } {
  try {
    return { value: f(), panic: "" };
  } catch (e) {
    if (e instanceof MemFsPanic) return { panic: e.message };
    if (e instanceof RangeError || e instanceof TypeError) return { panic: "panic: " + e.message };
    throw e;
  }
}

for (let i = 0; i < vectors.paths.length; i++) {
  const { a, b } = vectors.paths[i];
  const w = expected.paths[i];
  const what = `path ${JSON.stringify(a)} ${JSON.stringify(b)}`;
  if (w.a !== a || w.b !== b) throw new Error("vector order");
  if (w.panic) {
    // the only panic that these functions have is a slice out of range inside the reference; the port must not be asked
    byField["reference panics"] = (byField["reference panics"] ?? 0) + 1;
    if (show.length < 60) show.push(`${what} reference panic: ${w.panic}`);
    continue;
  }
  eq(what, "rootLength", getRootLength(a), w.rootLength);
  eq(what, "isRooted", isRootedDiskPath(a), w.isRooted);
  eq(what, "normalizedAbsolute", getNormalizedAbsolutePath(a, b), w.normalizedAbsolute);
  eq(what, "normalizePath", normalizePath(a), w.normalizePath);
  eq(what, "combine", combinePaths(b, a), w.combine);
  eq(what, "directory", getDirectoryPath(a), w.directory);
  eq(what, "base", getBaseFileName(a), w.base);
  eq(what, "anyExtension", getAnyExtensionFromPathEx(a, undefined, false), w.anyExtension);
  eq(what, "hasExtension", hasExtension(a), w.hasExtension);
  eq(what, "normalizedComponents", getNormalizedPathComponents(a, b), w.normalizedComponents);
  eq(what, "pathComponents", getPathComponents(a, b), w.pathComponents);
  eq(what, "fromComponents", getPathFromPathComponents(getNormalizedPathComponents(a, b)), w.fromComponents);
  eq(what, "containsSensitive", containsPath(b, a, { useCaseSensitiveFileNames: true, currentDirectory: "" }), w.containsSensitive);
  eq(what, "containsInsensitive", containsPath(b, a, { useCaseSensitiveFileNames: false, currentDirectory: "" }), w.containsInsensitive);
  eq(what, "relativeSensitive", convertToRelativePath(a, { useCaseSensitiveFileNames: true, currentDirectory: b }), w.relativeSensitive);
  eq(what, "relativeInsensitive", convertToRelativePath(a, { useCaseSensitiveFileNames: false, currentDirectory: b }), w.relativeInsensitive);
  eq(what, "toPathSensitive", toPathEx(a, b, true), w.toPathSensitive);
  eq(what, "toPathInsensitive", toPathEx(a, b, false), w.toPathInsensitive);
  eq(what, "changeExtensionJs", changeExtension(a, ".js"), w.changeExtensionJs);
  eq(what, "isDts", fileExtensionIs(a, ".d.ts"), w.isDts);
  eq(what, "isJson", fileExtensionIs(a, ".json"), w.isJson);
  eq(what, "isTsBuildInfo", fileExtensionIs(a, ".tsbuildinfo"), w.isTsBuildInfo);
  eq(what, "compareSensitive", compareStringsCaseSensitive(a, b), w.compareSensitive);
  eq(what, "compareInsensitive", compareStringsCaseInsensitive(a, b), w.compareInsensitive);
  eq(what, "removeTrailing", removeTrailingDirectorySeparator(a), w.removeTrailing);
  eq(what, "ensureTrailing", ensureTrailingDirectorySeparator(a), w.ensureTrailing);
}

function walk(fs: MemFs, dir: string, out: string[], depth: number) {
  if (depth > 12) return;
  const e = fs.getAccessibleEntries(dir);
  const trim = (s: string) => (s.endsWith("/") ? s.slice(0, -1) : s);
  for (const f of e.files) out.push(`F ${trim(dir)}/${f} link=${e.symlinks.has(f)} real=${fs.realpath(trim(dir) + "/" + f)}`);
  for (const d of e.directories) {
    const p = trim(dir) + "/" + d;
    out.push(`D ${p} link=${e.symlinks.has(d)} real=${fs.realpath(p)}`);
    walk(fs, p, out, depth + 1);
  }
}

let matchPanics = 0;
for (let i = 0; i < vectors.match.length; i++) {
  const v = vectors.match[i];
  const w = expected.match[i];
  if (w.name !== v.name) throw new Error("vector order");
  const what = "match " + v.name;
  const r = guard(() => {
    const m = new Map<string, MemInput>();
    for (const f of v.files) m.set(f, { kind: "file", data: new Uint8Array(0) });
    for (const [link, target] of Object.entries(v.symlinks as Record<string, string>)) m.set(link, { kind: "symlink", target });
    const fs = new MemFs(m, v.ucsfn);
    const options = { allowJs: v.allowJs ? 2 : 1, checkJs: 0, resolveJsonModule: v.json ? 2 : 1, module: 0, moduleResolution: 0, target: 0, outDir: "", declarationDir: "" };
    const fileNames = getFileNamesFromConfigSpecs({ validatedFilesSpec: v.fileSpec, validatedIncludeSpecs: v.includes, validatedExcludeSpecs: v.excludes }, v.basePath, options, fs);
    const entries: string[] = [];
    const first = [...m.keys()][0];
    const root = first.startsWith("/") ? "/" : first.slice(0, getRootLength(first));
    walk(fs, root, entries, 0);
    return { fileNames, entries };
  });
  if (w.panic) {
    matchPanics++;
    eq(what, "panic", r.panic !== "", true);
    continue;
  }
  eq(what, "panic", r.panic, "");
  if (r.value === undefined) continue;
  eq(what, "fileNames", r.value.fileNames, w.fileNames);
  eq(what, "entries", r.value.entries, w.entries);
}
console.log(JSON.stringify({ pathVectors: vectors.paths.length, matchVectors: vectors.match.length, matchVectorsWhereTheReferencePanics: matchPanics, checked, bad, byField }));
for (const s of show) console.log(s);
