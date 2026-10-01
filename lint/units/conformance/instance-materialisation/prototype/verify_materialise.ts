// Research probe: every run instance written to disk and read back, against the model of the reference's file system.
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { buildHarnessFs, newCompilerTest } from "./compiler_test";
import { enumerateInstances } from "./enum_runner";
import { ancestorPollution, materialise, probePlatform } from "./materialize";
import { MemFs, type MemInput } from "./memfs";
import { readFile } from "./readfile";

const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const libRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/lib";
const base = process.argv[2] ?? "/tmp/im/mat";
rmSync(base, { recursive: true, force: true });
mkdirSync(base, { recursive: true });
const platform = probePlatform(base + "/probe");
console.log("platform", JSON.stringify(platform), "ancestor pollution", ancestorPollution(base + "/0") ?? "none");

// the files of the directory of test libraries, as testLibFolderMap reads them
const libFiles = new Map<string, Uint8Array>();
const walkLib = (dir: string, rel: string) => {
  for (const name of readdirSync(dir).sort()) {
    const p = dir + "/" + name;
    if (lstatSync(p).isDirectory()) walkLib(p, rel + "/" + name);
    else libFiles.set("/.lib" + rel + "/" + name, readFileSync(p));
  }
};
walkLib(libRoot, "");
console.log("lib files", libFiles.size, [...libFiles].reduce((a, [, b]) => a + b.length, 0), "bytes", [...libFiles.keys()].join(" "));

const e = enumerateInstances({ casesRoot });
const cache = new Map<string, string>();
const c: Record<string, number> = {};
const bump = (k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
const problems: string[] = [];
let n = 0;
let files = 0;
let bytes = 0;
const t0 = performance.now();
for (const inst of e.instances) {
  if (inst.status !== "run") continue;
  const file = casesRoot + "/" + inst.casePath;
  let content = cache.get(file);
  if (content === undefined) {
    content = readFile(file).contents;
    cache.set(file, content);
  }
  const config = inst.config === undefined ? undefined : new Map(inst.config);
  const r = newCompilerTest(content, file, config);
  if (!r.ok) {
    bump("roots " + r.status);
    continue;
  }
  const t = r.value;
  const ucsfn = (config?.get("usecasesensitivefilenames") ?? "true").toLowerCase() !== "false";
  const fsx = buildHarnessFs(t, { libFiles: [], noLib: false, useCaseSensitiveFileNames: ucsfn });
  const root = base + "/" + n++;
  const m = materialise(fsx, t.currentDirectory, libFiles, root, platform);
  if (!m.ok) {
    bump("status " + m.status);
    continue;
  }
  bump("materialised");
  // the model again, to compare the disk with it
  const input = new Map<string, MemInput>(fsx.entries);
  if (fsx.includeLibDir) for (const [name, data] of libFiles) input.set(name, { kind: "file", data });
  const model = new MemFs(input, ucsfn);
  let ok = true;
  const extra = new Set<string>();
  const say = (s: string) => {
    ok = false;
    if (problems.length < 50) problems.push(inst.suite + "/" + inst.name + ": " + s);
  };
  // every entry of the model: kind, bytes, real path
  for (const [key, entry] of model.m) {
    const p = root + "/" + entry.realpath;
    let st;
    try {
      st = lstatSync(p);
    } catch {
      say("missing " + p);
      continue;
    }
    if (entry.kind === "file") {
      files++;
      bytes += entry.data.length;
      if (!st.isFile()) say("not a file " + p);
      else if (Buffer.compare(readFileSync(p), Buffer.from(entry.data)) !== 0) say("bytes differ " + p);
    } else if (entry.kind === "dir") {
      if (!st.isDirectory()) say("not a directory " + p);
    } else if (!st.isSymbolicLink()) say("not a link " + p);
    void key;
  }
  // every directory of the model lists what the disk lists, and real paths agree
  const walk = (virtualDir: string, depth: number) => {
    if (depth > 16) return;
    const want = model.getAccessibleEntries(virtualDir);
    const realDir = virtualDir === "/" ? root : root + virtualDir;
    let got: string[];
    try {
      got = readdirSync(realDir).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    } catch {
      say("cannot list " + realDir);
      return;
    }
    // a link whose target is absent is on the disk and not among the accessible entries
    const accessible = [...want.files, ...want.directories].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const gotAccessible = got.filter(name => {
      // the current directory is made when the instance has no file below it; the model has no such directory
      const v = (virtualDir === "/" ? "" : virtualDir) + "/" + name;
      if ((t.currentDirectory === v || t.currentDirectory.startsWith(v + "/")) && model.stat(v) === undefined) {
        extra.add(v);
        return false;
      }
      try {
        realpathSync(realDir + "/" + name);
        return true;
      } catch {
        return false;
      }
    });
    if (JSON.stringify(accessible) !== JSON.stringify(gotAccessible)) say(`listing of ${virtualDir}: model ${accessible.join(",")} disk ${gotAccessible.join(",")}`);
    for (const name of accessible) {
      const v = (virtualDir === "/" ? "" : virtualDir) + "/" + name;
      const wantReal = model.realpath(v);
      const gotReal = realpathSync(root + v);
      if (root + wantReal !== gotReal) say(`real path of ${v}: model ${wantReal} disk ${gotReal.slice(root.length)}`);
    }
    for (const d of want.directories) {
      if (want.symlinks.has(d)) continue;
      walk((virtualDir === "/" ? "" : virtualDir) + "/" + d, depth + 1);
    }
  };
  walk("/", 0);
  // the way back
  for (const name of fsx.entries.keys()) {
    const back = m.value.toVirtual(m.value.toReal(name));
    if (back !== name) say(`way back of ${name}: ${back}`);
    const text = `${m.value.toReal(name)}(1,1): error TS1: '${m.value.toReal(name)}' and "${root}".`;
    const mapped = m.value.mapText(text);
    if (mapped !== `${name}(1,1): error TS1: '${name}' and "/".`) say(`text: ${mapped}`);
  }
  for (let i = 0; i < fsx.programFileNames.length; i++) {
    if (m.value.toVirtual(m.value.roots[i]) !== fsx.programFileNames[i]) say("root " + i);
  }
  if (!lstatSync(m.value.currentDirectory).isDirectory()) say("current directory");
  if (extra.size > 0) bump("instances where the current directory is the only addition");
  if (ok) bump("agree with the model");
  else bump("differ from the model");
}
console.log(JSON.stringify(c), "files", files, "bytes", bytes, "seconds", ((performance.now() - t0) / 1000).toFixed(1));
for (const p of problems) console.log(p.slice(0, 300));
