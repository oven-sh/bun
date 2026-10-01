// Compares the prototype port with the ground truth dump of the reference, instance by instance.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { enumerateFiles, getCompilerFileBasedTest, getConfiguredName, skippedTests } from "../../../enumerator/prototype/compiler_runner";
import { getBaseFileName } from "../../../enumerator/prototype/tspath";
import { readFile } from "../../../enumerator/prototype/vfs";
import { newCompilerTest } from "./compiler_test";

const casesRoot = process.argv[2] ?? "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const dumpPath = process.argv[3] ?? import.meta.dir + "/../vectors/roots.jsonl.gz";
const truth = new Map<string, any>();
for (const l of gunzipSync(readFileSync(dumpPath)).toString("utf8").split("\n")) {
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
const resolutions = new Map<string, Map<string, string>>([
  ["compiler/tsconfigExtendsPackageJsonExportsWildcard.ts", new Map([["foo/strict.json", "/node_modules/foo/configs/strict.json"]])],
]);
const sortKeys = (o: any) => (o == null ? null : Object.fromEntries(Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : 1))));
let n = 0;
let same = 0;
const diffs: string[] = [];
const statuses: Record<string, number> = {};
const t0 = performance.now();
for (const suite of ["compiler", "conformance"] as const) {
  for (const filename of enumerateFiles(casesRoot + "/" + suite, true)) {
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
      const r = newCompilerTest(read.contents, filename, config === undefined ? undefined : new Map(config.config), resolutions.get(suite + "/" + basename));
      const theirStop: string | undefined = t.stop ?? t.vfsPanic;
      if (!r.ok) {
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        if (theirStop !== undefined && r.status === "invalid") {
          const text = theirStop.replace(/^(panic|fatal): /, "");
          if (text === r.reason) same++;
          else diffs.push(`${suite}/${name}: reason: port ${JSON.stringify(r.reason)} reference ${JSON.stringify(theirStop)}`);
        } else diffs.push(`${suite}/${name}: ${r.status}: ${r.reason}; reference ${JSON.stringify(theirStop)}`);
        continue;
      }
      if (theirStop !== undefined) {
        diffs.push(`${suite}/${name}: the reference stops (${theirStop}) and the port does not`);
        continue;
      }
      const v = r.value;
      const mine = {
        currentDirectory: v.currentDirectory,
        hasNonDtsFiles: v.hasNonDtsFiles,
        configFiles: v.tsConfigFiles.map(f => f.unitName),
        roots: v.toBeCompiled.map(f => f.unitName),
        otherFiles: v.otherFiles.map(f => f.unitName),
        programFileNames: v.programFileNames,
        includeLibDir: v.includeLibDir,
        useCaseSensitiveFileNames: v.useCaseSensitiveFileNames,
        symlinks: Object.fromEntries([...v.symlinks].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
        configFileNames: v.configFileNames ?? null,
        configOptions: sortKeys(v.configOptions === undefined ? undefined : { ...(v.configOptions as object), noLib: undefined }),
      };
      const theirs = {
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
        configOptions: sortKeys(t.configOptions == null ? t.configOptions : { ...t.configOptions, noLib: undefined }),
      };
      let ok = true;
      for (const k of Object.keys(mine) as (keyof typeof mine)[]) {
        if (!eq(mine[k], theirs[k])) {
          ok = false;
          diffs.push(`${suite}/${name}: ${k}: port ${JSON.stringify(mine[k])} reference ${JSON.stringify(theirs[k])}`);
        }
      }
      // bytes of every file of the virtual disk; a later unit of the same name replaces an earlier one, a link replaces a file
      const disk = new Map<string, Uint8Array>();
      for (const f of [...v.toBeCompiled, ...v.otherFiles]) disk.set(f.unitName, Buffer.from(f.content, "utf8"));
      for (const l of v.symlinks.keys()) disk.delete(l);
      const theirFiles = (t.entries as any[]).filter(e => e.length === 3).map(e => ({ path: e[0], size: e[1], sha: e[2] }));
      const mineEntries = [...disk].map(([path, b]) => ({ path, size: b.length, sha: fnv(b) })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const theirEntries = theirFiles.map(e => ({ path: e.path, size: e.size, sha: e.sha })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      if (!eq(mineEntries, theirEntries)) {
        // a unit below /.lib is replaced by the file of tests/lib when the lib directory is mounted; the dump leaves those out
        if (!(v.includeLibDir && mineEntries.some(e => e.path.startsWith("/.lib/")))) ok = false;
        if (!ok) diffs.push(`${suite}/${name}: entries: port ${JSON.stringify(mineEntries).slice(0, 300)} reference ${JSON.stringify(theirEntries).slice(0, 300)}`);
      }
      if (ok) same++;
    }
  }
}
console.log(JSON.stringify({ instances: n, same, different: n - same, statuses, ms: Math.round(performance.now() - t0) }));
for (const d of diffs.slice(0, 60)) console.log(d);
