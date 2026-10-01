// runner/vfstest.ts against the reference's own vfstest behind iovfs, run by Go 1.26 (groundtruth/main.go): construction, the five read calls, the panic texts.
// usage: bun verify.ts <runner directory> [vectors.json(.gz)] [truth.jsonl(.gz)] [unstable.json]      exit code 1 when a result differs
// A vector of unstable.json is one where runs of Go differ among themselves (the map order of Go): it is counted and not compared.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const here = import.meta.dir;
const runner = process.argv[2];
const vectorsPath = process.argv[3] ?? here + "/vectors/vectors.json.gz";
const truthPath = process.argv[4] ?? here + "/vectors/go126.jsonl.gz";
const unstablePath = process.argv[5] ?? here + "/vectors/unstable.json";
const read = (p: string) => (p.endsWith(".gz") ? gunzipSync(readFileSync(p)) : readFileSync(p)).toString("utf8");

const { MemFs, MemFsPanic } = await import(runner + "/vfstest.ts");
const { decodeBytes } = await import(runner + "/vfs.ts");
const { utf8String, utf8Bytes } = await import(runner + "/gostrings.ts");

const vectors = JSON.parse(read(vectorsPath)) as any[];
const truth = read(truthPath).split("\n").filter(l => l !== "");
const unstable = new Set<number>(JSON.parse(read(unstablePath)));
if (truth.length !== vectors.length) throw new Error(`${vectors.length} vectors and ${truth.length} results`);

function runPort(v: any): any {
  const r: any = { name: v.name, probes: [] };
  const input = new Map<string, any>();
  for (const f of v.files) input.set(f, { kind: "file", data: utf8Bytes(f) });
  for (const [link, target] of Object.entries(v.symlinks)) input.set(link, { kind: "symlink", target });
  let fs: any;
  try {
    fs = new MemFs(input, v.ucsfn);
  } catch (e) {
    if (!(e instanceof MemFsPanic)) throw e;
    r.panic = (e as Error).message;
    return r;
  }
  for (const p of v.probes) {
    const pr: any = { path: p, fileExists: false, dirExists: false, readOk: false, contents: "", realpath: "", files: [], directories: [], symlinks: [] };
    try {
      pr.fileExists = fs.fileExists(p);
      pr.dirExists = fs.directoryExists(p);
      const b = fs.readFile(p);
      pr.readOk = b !== undefined;
      pr.contents = b === undefined ? "" : utf8String(decodeBytes(b));
      pr.realpath = fs.realpath(p);
      const e = fs.getAccessibleEntries(p);
      pr.files = e.files;
      pr.directories = e.directories;
      pr.symlinks = [...e.symlinks].sort();
    } catch (e) {
      if (!(e instanceof MemFsPanic)) throw e;
      pr.panic = (e as Error).message;
    }
    r.probes.push(pr);
  }
  return r;
}

const c = { vectors: vectors.length, goEndsWithAFatalError: 0, goVaries: 0, compared: 0, constructionPanics: 0, probes: 0, probePanics: 0, differ: 0, panicTextDiffers: 0 };
const shown: string[] = [];
const norm = (x: unknown) => JSON.stringify(x);
const show = (s: string) => {
  if (shown.length < 25) shown.push(s);
};
for (let i = 0; i < vectors.length; i++) {
  const v = vectors[i];
  const want = JSON.parse(truth[i]);
  // Where the reference overflows its stack, the port has to come back.
  const got = runPort(v);
  if (want.crash) {
    c.goEndsWithAFatalError++;
    continue;
  }
  if (unstable.has(i)) {
    c.goVaries++;
    continue;
  }
  c.compared++;
  const input = norm({ files: v.files, symlinks: v.symlinks, ucsfn: v.ucsfn });
  if (want.panic) c.constructionPanics++;
  if (Boolean(want.panic) !== Boolean(got.panic)) {
    c.differ++;
    show(`${v.name}: construction panic go=${norm(want.panic)} port=${norm(got.panic)}\n    ${input}`);
    continue;
  }
  if (want.panic) {
    if (want.panic !== got.panic) {
      c.panicTextDiffers++;
      show(`${v.name}: panic text go=${norm(want.panic)} port=${norm(got.panic)}`);
    }
    continue;
  }
  for (let k = 0; k < v.probes.length; k++) {
    c.probes++;
    const w = want.probes[k];
    const g = got.probes[k];
    if (w.panic) c.probePanics++;
    if (Boolean(w.panic) !== Boolean(g.panic)) {
      c.differ++;
      show(`${v.name} ${norm(w.path)}: panic go=${norm(w.panic)} port=${norm(g.panic)}\n    ${input}`);
    } else if (w.panic) {
      if (w.panic !== g.panic) {
        c.panicTextDiffers++;
        show(`${v.name} ${norm(w.path)}: panic text go=${norm(w.panic)} port=${norm(g.panic)}`);
      }
    } else if (norm(w) !== norm(g)) {
      c.differ++;
      show(`${v.name} ${norm(w.path)}:\n    go   ${norm(w)}\n    port ${norm(g)}\n    ${input}`);
    }
  }
}
console.log(norm(c));
for (const s of shown) console.log(s);
process.exit(c.differ + c.panicTextDiffers === 0 ? 0 : 1);
