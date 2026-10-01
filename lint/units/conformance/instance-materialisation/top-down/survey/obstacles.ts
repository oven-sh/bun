// Survey: which instances cannot be written to a real disk faithfully, by cause.
import { enumerateFiles, getCompilerFileBasedTest, getConfiguredName, getStatus, skippedTests } from "../../../enumerator/prototype/compiler_runner";
import { getBaseFileName, getRootLength } from "../../../enumerator/prototype/tspath";
import { readFile } from "../../../enumerator/prototype/vfs";
import { newCompilerTest } from "../prototype/compiler_test";
import { writeFileSync } from "node:fs";

const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const resolutions = new Map<string, Map<string, string>>([
  ["compiler/tsconfigExtendsPackageJsonExportsWildcard.ts", new Map([["foo/strict.json", "/node_modules/foo/configs/strict.json"]])],
]);
type Row = { name: string; suite: string; casePath: string; run: boolean; causes: string[]; maxPath: number; maxSegment: number; detail: Record<string, string[]> };
const rows: Row[] = [];
const winReserved = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const winBadChar = /[<>:"|?*\x00-\x1f]/;
// rooted specifiers inside the text of a unit: triple slash references, imports, requires
const refRe = /<reference\s+(?:path|types|lib)\s*=\s*["']([^"']+)["']/g;
const specRe = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+|\bmodule\s+)(["'])((?:\/|[a-zA-Z]:[\\/]|\\)[^"']*)\1/g;
function rooted(p: string) { return getRootLength(p.replaceAll("\\", "/")) > 0; }
for (const suite of ["compiler", "conformance"] as const) {
  for (const filename of enumerateFiles(casesRoot + "/" + suite, true)) {
    const basename = getBaseFileName(filename);
    if (skippedTests.includes(basename)) continue;
    const read = readFile(filename);
    const test = getCompilerFileBasedTest(read.contents);
    const configs = test.configurations.length > 0 ? test.configurations : [undefined];
    for (const config of configs) {
      const name = getConfiguredName(basename, config?.name ?? "");
      const st = getStatus(read.contents, filename, config === undefined ? undefined : new Map(config.config));
      const r = newCompilerTest(read.contents, filename, config === undefined ? undefined : new Map(config.config), resolutions.get(suite + "/" + basename));
      const row: Row = { name, suite, casePath: filename.slice(casesRoot.length + 1), run: st.status === "run", causes: [], maxPath: 0, maxSegment: 0, detail: {} };
      rows.push(row);
      const add = (cause: string, what: string) => {
        if (!row.causes.includes(cause)) row.causes.push(cause);
        (row.detail[cause] ??= []).push(what);
      };
      if (!r.ok) { add(r.status, r.reason); continue; }
      const v = r.value;
      const files = [...v.tsConfigFiles, ...v.toBeCompiled, ...v.otherFiles];
      const paths = [...new Set([...files.map(f => f.unitName), ...v.symlinks.keys()])];
      // 1. roots of the virtual names
      for (const p of paths) {
        const root = p.slice(0, getRootLength(p));
        if (root !== "/") add(/^[a-zA-Z]:/.test(root) ? "dos-root" : "other-root", p);
        row.maxPath = Math.max(row.maxPath, p.length);
        for (const seg of p.slice(root.length).split("/")) {
          row.maxSegment = Math.max(row.maxSegment, Buffer.byteLength(seg, "utf8"));
          if (winBadChar.test(seg)) add("windows-character", p);
          else if (winReserved.test(seg)) add("windows-reserved-name", p);
          else if (/[. ]$/.test(seg)) add("windows-trailing-dot-or-space", p);
          if (/[^\x00-\x7f]/.test(seg)) add("non-ascii-name", p);
        }
      }
      // 2. names that differ only in case, and a file that is also a directory of another path
      const lower = new Map<string, string>();
      for (const p of paths) {
        // every prefix directory counts: A/x.ts and a/y.ts collide as directories
        const segs = p.split("/");
        for (let i = 2; i <= segs.length; i++) {
          const prefix = segs.slice(0, i).join("/");
          const k = prefix.toLowerCase();
          const other = lower.get(k);
          if (other !== undefined && other !== prefix) add("case-collision", other + " | " + prefix);
          else lower.set(k, prefix);
        }
      }
      const set = new Set(paths);
      for (const p of paths) {
        const segs = p.split("/");
        for (let i = 2; i < segs.length; i++) if (set.has(segs.slice(0, i).join("/")) && !v.symlinks.has(segs.slice(0, i).join("/"))) add("file-is-directory", p);
      }
      // 3. the same name twice
      const seen = new Set<string>();
      for (const f of files) { if (seen.has(f.unitName)) add("unit-name-twice", f.unitName); seen.add(f.unitName); }
      // 4. settings
      if (!v.useCaseSensitiveFileNames) add("case-insensitive-requested", "");
      if (v.symlinks.size > 0) {
        for (const [l, t] of v.symlinks) {
          const isFile = files.some(f => f.unitName === t);
          add(isFile ? "link-to-file" : "link-to-directory", l + " -> " + t);
        }
      }
      if (v.includeLibDir) add("lib-directory", "");
      if (v.programFileNames.length === 0) add("no-program-file", "");
      if (v.currentDirectory !== "/.src") add("current-directory", v.currentDirectory);
      // 5. rooted paths inside the text of the units
      for (const f of files) {
        const isConfig = /(^|\/)(tsconfig|jsconfig)[^/]*\.json$/i.test(f.unitName) || /\.json$/i.test(f.unitName);
        if (isConfig) {
          for (const m of f.content.matchAll(/"((?:\/|[a-zA-Z]:[\\/])[^"\n]*)"/g)) add("rooted-path-in-json", f.unitName + ": " + m[1]);
          continue;
        }
        for (const m of f.content.matchAll(refRe)) if (rooted(m[1])) add(m[1].startsWith("/.lib/") ? "rooted-reference-lib" : "rooted-reference", f.unitName + ": " + m[1]);
        for (const m of f.content.matchAll(specRe)) add("rooted-specifier", f.unitName + ": " + m[2]);
      }
      // 6. rooted values in the settings of the case
      if (config !== undefined) {
        for (const [k, val] of config.config) {
          if (k === "currentdirectory" || k === "filename") continue;
          if (/(^|,)\s*(\/|[a-zA-Z]:[\\/])/.test(val)) add("rooted-setting", k + "=" + val);
        }
      }
      // 7. a relative specifier or reference that climbs above the root of the virtual disk
      for (const f of files) {
        const depth = f.unitName.split("/").length - 2;
        for (const m of f.content.matchAll(/["'`]((?:\.\.\/)+)[^"'`\n]*["'`]/g)) {
          if (m[1].length / 3 > depth) add("climbs-above-root", f.unitName + ": " + m[0]);
        }
      }
    }
  }
}
const count = (pred: (r: Row) => boolean) => rows.filter(pred).length;
const causes = new Map<string, { all: number; run: number; cases: Set<string> }>();
for (const r of rows) for (const c of r.causes) {
  const e = causes.get(c) ?? { all: 0, run: 0, cases: new Set() };
  e.all++; if (r.run) e.run++; e.cases.add(r.casePath);
  causes.set(c, e);
}
console.log("instances", rows.length, "run", count(r => r.run));
for (const [c, e] of [...causes].sort((a, b) => b[1].all - a[1].all)) console.log(c.padEnd(34), "instances", String(e.all).padStart(5), "run", String(e.run).padStart(5), "cases", String(e.cases.size).padStart(5));
const lens = rows.map(r => r.maxPath).sort((a, b) => a - b);
console.log("longest virtual path per instance: max", lens[lens.length - 1], "p99", lens[Math.floor(lens.length * 0.99)], "median", lens[lens.length >> 1]);
console.log("instances with a virtual path over 100:", count(r => r.maxPath > 100), "over 150:", count(r => r.maxPath > 150), "over 200:", count(r => r.maxPath > 200), "longest segment bytes", Math.max(...rows.map(r => r.maxSegment)));
writeFileSync(process.argv[2] ?? "/tmp/im-td/rows.json", JSON.stringify(rows));
