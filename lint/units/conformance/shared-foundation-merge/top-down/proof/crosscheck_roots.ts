// The split into roots and other files of the assembly (instance-materialisation/prototype and the glue of
// test-file-and-sweep/top-down/index.ts) against the dump of the reference that the other pass recorded
// (instance-materialisation/top-down/vectors/roots.jsonl.gz), instance by instance.
// usage: bun crosscheck_roots.ts <tree: a copy of notes/lint/units/conformance>
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const tree = process.argv[2];
const im = tree + "/instance-materialisation/prototype/";
const { enumerateFiles, getCompilerFileBasedTest, getConfiguredName, skippedTests } = await import(im + "enum_runner.ts");
const { buildHarnessFs, newCompilerTest } = await import(im + "compiler_test.ts");
const { readFile } = await import(im + "readfile.ts");
const { getBaseFileName } = await import(im + "tspath.ts");

const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const truth = new Map<string, any>();
for (const l of gunzipSync(readFileSync(tree + "/instance-materialisation/top-down/vectors/roots.jsonl.gz")).toString("utf8").split("\n")) {
  if (l === "") continue;
  const r = JSON.parse(l);
  truth.set(r.suite + "/" + r.name, r);
}
function fnv(b: Uint8Array): string {
  let h = 14695981039346656037n;
  for (const c of b) {
    h ^= BigInt(c);
    h = (h * 1099511628211n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let n = 0;
let same = 0;
const statuses: Record<string, number> = {};
const byField: Record<string, number> = {};
const diffs: string[] = [];
for (const suite of ["compiler", "conformance"]) {
  for (const filename of enumerateFiles(casesRoot + "/" + suite, true) as string[]) {
    const basename = getBaseFileName(filename);
    if (skippedTests.includes(basename)) continue;
    const read = readFile(filename);
    const test = getCompilerFileBasedTest(read.contents);
    const configs = test.configurations.length > 0 ? test.configurations : [undefined];
    for (const config of configs) {
      n++;
      const name = getConfiguredName(basename, config?.name ?? "");
      const t = truth.get(suite + "/" + name);
      if (t === undefined) {
        diffs.push(`${suite}/${name}: not in the dump`);
        continue;
      }
      const map: Map<string, string> | undefined = config === undefined ? undefined : new Map(config.config);
      const r = newCompilerTest(read.contents, filename, map);
      const theirStop: string | undefined = t.stop ?? t.vfsPanic;
      if (!r.ok) {
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        if (theirStop !== undefined && r.status === "invalid" && theirStop.replace(/^(panic|fatal): /, "") === r.reason) same++;
        else diffs.push(`${suite}/${name}: ${r.status}: ${r.reason}; reference ${JSON.stringify(theirStop)}`);
        continue;
      }
      if (theirStop !== undefined) {
        diffs.push(`${suite}/${name}: the reference stops (${theirStop}) and the port does not`);
        continue;
      }
      const v = r.value;
      // The glue of index.ts: what the harness options give to the file system.
      const configuration: Record<string, string> = {};
      for (const [k, val] of map ?? new Map<string, string>()) configuration[k] = val;
      const ucsfn = (configuration["usecasesensitivefilenames"] ?? "true").toLowerCase() !== "false";
      const libNames = (configuration["libfiles"] ?? "").split(",").map(s => s.trim()).filter(s => s !== "");
      const noLib = (configuration["nolib"] ?? "").toLowerCase() === "true";
      const fsx = buildHarnessFs(v, { libFiles: libNames, noLib, useCaseSensitiveFileNames: ucsfn });
      const mine: Record<string, unknown> = {
        currentDirectory: v.currentDirectory,
        hasNonDtsFiles: v.hasNonDtsFiles,
        configFiles: v.tsConfigFiles.map((f: any) => f.unitName),
        roots: v.toBeCompiled.map((f: any) => f.unitName),
        otherFiles: v.otherFiles.map((f: any) => f.unitName),
        programFileNames: fsx.programFileNames,
        includeLibDir: fsx.includeLibDir,
        useCaseSensitiveFileNames: ucsfn,
        symlinks: Object.fromEntries([...fsx.entries].filter(([, e]: any) => e.kind === "symlink").map(([p, e]: any) => [p, e.target]).sort((a: any, b: any) => (a[0] < b[0] ? -1 : 1))),
        configFileNames: v.configFileNames ?? null,
      };
      const theirs: Record<string, unknown> = {
        currentDirectory: t.currentDirectory,
        hasNonDtsFiles: t.hasNonDtsFiles,
        configFiles: t.configFiles,
        roots: t.roots,
        otherFiles: t.otherFiles,
        programFileNames: t.programFileNames,
        includeLibDir: t.includeLibDir,
        useCaseSensitiveFileNames: t.useCaseSensitiveFileNames,
        symlinks: Object.fromEntries(Object.entries(t.symlinks).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
        configFileNames: t.configFileNames,
      };
      let ok = true;
      for (const k of Object.keys(mine)) {
        if (!eq(mine[k], theirs[k])) {
          ok = false;
          byField[k] = (byField[k] ?? 0) + 1;
          diffs.push(`${suite}/${name}: ${k}: port ${JSON.stringify(mine[k])?.slice(0, 200)} reference ${JSON.stringify(theirs[k])?.slice(0, 200)}`);
        }
      }
      // Bytes of every file of the virtual disk.
      const disk = new Map<string, Uint8Array>();
      for (const f of [...v.toBeCompiled, ...v.otherFiles]) disk.set(f.unitName, Buffer.from(f.content, "utf8"));
      for (const l of Object.keys(t.symlinks)) disk.delete(l);
      const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const mineEntries = [...disk].map(([path, b]) => ({ path, size: b.length, sha: fnv(b) })).sort(byPath);
      const theirEntries = (t.entries as any[]).filter(e => e.length === 3).map(e => ({ path: e[0], size: e[1], sha: e[2] })).sort(byPath);
      if (!eq(mineEntries, theirEntries) && !(fsx.includeLibDir && mineEntries.some(e => e.path.startsWith("/.lib/")))) {
        ok = false;
        byField["entries"] = (byField["entries"] ?? 0) + 1;
        diffs.push(`${suite}/${name}: entries: port ${JSON.stringify(mineEntries).slice(0, 200)} reference ${JSON.stringify(theirEntries).slice(0, 200)}`);
      }
      if (ok) same++;
    }
  }
}
console.log(JSON.stringify({ instances: n, same, different: n - same, statuses, byField }));
for (const d of diffs.slice(0, 40)) console.log(d);
