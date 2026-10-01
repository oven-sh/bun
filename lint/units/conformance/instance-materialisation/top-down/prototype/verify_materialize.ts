// Writes every instance below a temporary directory and checks the disk against the dump of the reference.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { enumerateFiles, getCompilerFileBasedTest, getConfiguredName, skippedTests } from "../../../enumerator/prototype/compiler_runner";
import { getBaseFileName } from "../../../enumerator/prototype/tspath";
import { readFile } from "../../../enumerator/prototype/vfs";
import { newCompilerTest } from "./compiler_test";
import { materialize } from "./materialize";

const casesRoot = process.argv[2] ?? "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const dumpPath = process.argv[3] ?? import.meta.dir + "/../vectors/roots.jsonl.gz";
const readsAbsolutePaths = process.argv[4] === "disk";
const libDirectory = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/lib";
const resolutions = new Map<string, Map<string, string>>([
  ["compiler/tsconfigExtendsPackageJsonExportsWildcard.ts", new Map([["foo/strict.json", "/node_modules/foo/configs/strict.json"]])],
]);
const truth = new Map<string, any>();
for (const l of gunzipSync(readFileSync(dumpPath)).toString("utf8").split("\n")) {
  if (l === "") continue;
  const r = JSON.parse(l);
  if (r.entries !== undefined) r.entries = r.entries.map((e: any[]) => (e.length === 3 ? { path: e[0], size: e[1], sha: e[2] } : { path: e[0], link: e[1], isLink: true }));
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
function walk(dir: string, prefix: string, out: Map<string, "file" | "link">) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = prefix + "/" + e.name;
    if (e.isSymbolicLink()) out.set(p, "link");
    else if (e.isDirectory()) walk(dir + "/" + e.name, p, out);
    else out.set(p, "file");
  }
}
const base = mkdtempSync(join(realpathSync.native(tmpdir()), "im_"));
let n = 0, written = 0, ok = 0, files = 0, bytes = 0, links = 0;
const refused: Record<string, number> = {};
const problems: string[] = [];
let msWrite = 0;
for (const suite of ["compiler", "conformance"] as const) {
  for (const filename of enumerateFiles(casesRoot + "/" + suite, true)) {
    const basename = getBaseFileName(filename);
    if (skippedTests.includes(basename)) continue;
    const read = readFile(filename);
    const test = getCompilerFileBasedTest(read.contents);
    const configs = test.configurations.length > 0 ? test.configurations : [undefined];
    // the disk of an instance depends on its configuration only through the current directory and the lib mount
    for (const config of configs) {
      n++;
      const name = getConfiguredName(basename, config?.name ?? "");
      const t = truth.get(suite + "/" + name);
      const r = newCompilerTest(read.contents, filename, config === undefined ? undefined : new Map(config.config), resolutions.get(suite + "/" + basename));
      if (!r.ok) { refused[r.status] = (refused[r.status] ?? 0) + 1; continue; }
      const root = base + "/" + n.toString(36);
      mkdirSync(root);
      const t0 = performance.now();
      const m = materialize(r.value, { root, platform: { os: "linux", caseSensitive: true }, libDirectory, readsAbsolutePaths });
      msWrite += performance.now() - t0;
      if (!m.ok) {
        for (const reason of new Set(m.obstacles.map(o => o.reason))) refused[reason] = (refused[reason] ?? 0) + 1;
        rmSync(root, { recursive: true, force: true });
        continue;
      }
      written++;
      let good = true;
      const bad = (what: string) => { good = false; if (problems.length < 40) problems.push(`${suite}/${name}: ${what}`); };
      const onDisk = new Map<string, "file" | "link">();
      walk(root, "", onDisk);
      const expected = new Map<string, any>();
      for (const e of t.entries as any[]) expected.set(e.path, e);
      for (const [p, e] of expected) {
        const real = m.value.toReal(p);
        if (e.isLink) {
          links++;
          if (onDisk.get(p) !== "link") { bad("link missing " + p); continue; }
          let a = "", b = "";
          const targetExists = [...expected.keys()].some(k => k === e.link || k.startsWith(e.link + "/"));
          // a link to nothing stays a link to nothing
          if (!targetExists) continue;
          try { a = realpathSync(real); b = realpathSync(m.value.toReal(e.link)); } catch (x) { bad("link does not resolve " + p); continue; }
          if (a !== b) bad(`link ${p} resolves to ${a}, wanted ${b}`);
        } else {
          const kind = onDisk.get(p);
          if (kind !== "file") { bad("file missing " + p + " (" + kind + ")"); continue; }
          const b = readFileSync(real);
          files++; bytes += b.length;
          if (b.length !== e.size || fnv(b) !== e.sha) bad("bytes differ " + p);
        }
        if (m.value.toVirtual(real) !== p) bad(`toVirtual(${real}) = ${m.value.toVirtual(real)}`);
      }
      for (const p of onDisk.keys()) {
        if (expected.has(p)) continue;
        if (r.value.includeLibDir && p.startsWith("/.lib/")) continue;
        // a file below a directory link shows up under the link when the walk does not follow links; it does not here
        bad("extra entry " + p);
      }
      if (m.value.operands.length !== t.programFileNames.length) bad("operand count");
      for (let i = 0; i < m.value.operands.length; i++) {
        const back = m.value.toVirtual(m.value.operands[i]);
        if (back !== t.programFileNames[i]) bad(`operand ${m.value.operands[i]} maps to ${back}, wanted ${t.programFileNames[i]}`);
      }
      if (realpathSync(m.value.cwd) !== realpathSync(root + (t.currentDirectory === "/" ? "" : t.currentDirectory))) bad("cwd");
      const first = [...expected.keys()].find(p => !expected.get(p).isLink);
      if (first !== undefined) {
        const real = m.value.toReal(first);
        const text = `${real}(3,7): error TS6059: File '${real}' is not under 'rootDir' '${root}'. 'rootDir' is expected to contain all source files.\n  The file is in the program because:\n    Root file specified for compilation at ${real}:3:7\n`;
        const want = `${first}(3,7): error TS6059: File '${first}' is not under 'rootDir' '/'. 'rootDir' is expected to contain all source files.\n  The file is in the program because:\n    Root file specified for compilation at ${first}:3:7\n`;
        const got = m.value.mapText(text);
        if (got !== want) bad(`mapText gave ${JSON.stringify(got)}`);
      }
      if (good) ok++;
      rmSync(root, { recursive: true, force: true });
    }
  }
}
rmSync(base, { recursive: true, force: true });
console.log(JSON.stringify({ mode: readsAbsolutePaths ? "checker reads the real disk" : "writer only", instances: n, written, verified: ok, refused, files, bytes, links, msWrite: Math.round(msWrite) }));
for (const p of problems) console.log(p);
