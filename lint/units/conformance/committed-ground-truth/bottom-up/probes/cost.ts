// Measures what one candidate check of a committed fixture costs: wall time and processor time of the step alone.
// usage: <bun> cost.ts <assembled runner set> <directory that holds corpus/> <step> [step ...]
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [asm, home, ...steps] = process.argv.slice(2);
const runner = asm + "/test/cli/lint/conformance/runner/";
const notes = "/workspace/notes/lint/units/conformance";
const R = await import(runner + "index.ts");
const G = await import(runner + "gostrings.ts");
const P = await import(runner + "test_case_parser.ts");
const S = await import(runner + "scanner.ts");
const V = await import(runner + "vfs.ts");
const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const layout = {
  casesRoot: home + "/corpus/ts/tests/cases",
  libRoot: home + "/corpus/ts/tests/lib",
  tsgoBaselines: home + "/corpus/tsgo/testdata/baselines/reference/submodule",
  tsBaselines: home + "/corpus/ts/tests/baselines/reference",
  expectsNoErrors: home + "/corpus/tsgo.expects-no-errors.txt",
  accepted: home + "/corpus/tsgo/testdata/submoduleAccepted.txt",
  triaged: home + "/corpus/tsgo/testdata/submoduleTriaged.txt",
  postEmitOrder: asm + "/test/cli/lint/conformance/post-emit-order.txt",
};
const fixtures = home + "/fixtures";
const sampled = (path: string, n: number) => Bun.hash.crc32(path) % n === 0;

function canonOf(rel: string): string {
  const r = V.readFile(layout.casesRoot + "/" + rel);
  if (!r.ok) throw new Error(rel + ": cannot read");
  const content: string = r.contents;
  const unitLine = (c: string) => `${Buffer.byteLength(c, "utf8")} ${sha256(Buffer.from(c, "utf8"))}`;
  const made = P.makeUnitsFromTest(content, rel);
  const rec: string[] = [];
  rec.push(`decoded ${Buffer.byteLength(content, "utf8")} ${sha256(Buffer.from(content, "utf8"))}`);
  rec.push("panic " + (made.ok ? "" : made.reason));
  const cdRaw = made.ok && made.value.globalOptions.has("currentdirectory") ? made.value.globalOptions.get("currentdirectory")! : "";
  rec.push("currentDirectory " + cdRaw);
  const maps: [string, Map<string, string>][] = [
    ["settings", P.extractCompilerSettings(content)],
    ["globalOptions", made.ok ? made.value.globalOptions : new Map()],
  ];
  for (const [field, m] of maps) {
    rec.push(`${field} ${m.size}`);
    for (const k of [...m.keys()].sort(G.compareStrings)) rec.push(k + "=" + m.get(k));
  }
  const sym: Map<string, string> = made.ok ? made.value.symlinks : new Map();
  rec.push(`symlinks ${sym.size}`);
  for (const k of [...sym.keys()].sort(G.compareStrings)) {
    rec.push(k);
    rec.push(sym.get(k)!);
  }
  const config = made.ok ? made.value.tsConfigFileUnitData : undefined;
  rec.push(`configUnit ${config ? 1 : 0}`);
  if (config) {
    rec.push(config.name);
    rec.push(unitLine(config.content));
  }
  const units = made.ok ? made.value.testUnitData : [];
  rec.push(`units ${units.length}`);
  for (const u of units) {
    rec.push(u.name);
    rec.push(unitLine(u.content));
  }
  return sha256(Buffer.from(rec.map(x => x + "\n").join(""), "utf8"));
}

// The id that git gives a file: sha1 of "blob <length>\0" and the bytes.
function blobId(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
function walkFiles(dir: string, rel: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walkFiles(dir + "/" + e.name, rel + e.name + "/", out);
    else out.push(rel + e.name);
  }
}

const all: Record<string, () => unknown> = {
  nothing: () => 0,
  directives: () => {
    const inputs: any[] = JSON.parse(readFileSync(notes + "/directive-grammar/vectors/synthetic-inputs.json", "utf8"));
    const expected: any[] = JSON.parse(readFileSync(notes + "/directive-grammar/vectors/synthetic-expected.json", "utf8"));
    const obj = (m: Map<string, string>) => Object.fromEntries([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    let same = 0;
    let refused = 0;
    inputs.forEach((i, k) => {
      const raw = Buffer.from(i.bytes, "base64");
      let content: string;
      try {
        content = raw.length === 0 ? "" : G.utf8String(V.decodeBytes(raw));
      } catch {
        refused++;
        return;
      }
      const bytes = G.utf8ToByteString(content);
      const o: any = { name: i.name, decoded: content, lines: content.split(/\r?\n/), settings: obj(P.extractCompilerSettings(content)), panic: "", units: [], configUnit: null, symlinks: {}, currentDirectory: "", globalOptions: {}, skipTrivia: S.skipTrivia(bytes, 0), error: "", decodedByteLen: bytes.length };
      const failOn = i.failOn ?? "";
      const r = P.parseTestFilesAndSymlinksWithOptions(content, i.fileName, (name: string, c: string, fileOptions: Map<string, string>) => (failOn !== "" && name === failOn ? { value: { name: "FAILED:" + name, content: c, fileOptions: obj(fileOptions) }, error: "cannot parse " + name } : { value: { name, content: c, fileOptions: obj(fileOptions) }, error: undefined }), { allowImplicitFirstFile: !!i.allowImplicitFirstFile });
      if (!r.ok) o.panic = r.reason;
      else {
        let units: any[] = r.units;
        o.error = r.error ?? "";
        o.symlinks = obj(r.symlinks);
        o.currentDirectory = r.currentDirectory;
        o.globalOptions = obj(r.globalOptions);
        if (!i.allowImplicitFirstFile) {
          const x = units.findIndex((u: any) => P.getConfigNameFromFileName(u.name) !== "");
          if (x >= 0) {
            o.configUnit = units[x];
            units = units.filter((_: unknown, y: number) => y !== x);
          }
        }
        o.units = units;
      }
      if (Bun.deepEquals(o, expected[k])) same++;
    });
    return { inputs: inputs.length, same, refused };
  },
  enumerate: () => {
    const corpus = R.loadCorpus(layout);
    const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
    const facts = e.instances.map((i: any) => R.factsOf(corpus, i));
    const sorted = [...facts].sort((a: any, b: any) => G.compareStrings(a.name, b.name));
    const status = sorted.map((f: any) => `${f.status}\t${f.name}\n`).join("");
    return { instances: facts.length, status: sha256(status).slice(0, 16) };
  },
  "enumerate-sample40": () => {
    const corpus = R.loadCorpus(layout);
    const cases = [...R.indexCases(layout.casesRoot).values()].filter((p: any) => sampled(p, 40)).sort();
    let n = 0;
    for (const path of cases) for (const i of R.enumerateCase(layout.casesRoot, path)) if (R.factsOf(corpus, i)) n++;
    return { cases: cases.length, instances: n };
  },
  index: () => R.indexCases(layout.casesRoot).size,
  canon: () => {
    const rels = [...R.indexCases(layout.casesRoot).values()].sort(G.compareStrings);
    const text = rels.map((rel: string) => rel + "\t" + canonOf(rel) + "\n").join("");
    const want = sha256(gunzipSync(readFileSync(notes + "/directive-grammar/vectors/cases.tsv.gz")));
    return { cases: rels.length, sha256: sha256(text), equalsGo: sha256(text) === want };
  },
  "canon-sample40": () => {
    const rels = [...R.indexCases(layout.casesRoot).values()].filter((p: any) => sampled(p, 40)).sort(G.compareStrings);
    const go = new Map<string, string>(gunzipSync(readFileSync(notes + "/directive-grammar/vectors/cases.tsv.gz")).toString("utf8").split("\n").filter(Boolean).map(l => l.split("\t") as [string, string]));
    let same = 0;
    for (const rel of rels) if (canonOf(rel) === go.get(rel)) same++;
    return { cases: rels.length, same };
  },
  "corpus-digest": () => {
    const files: string[] = [];
    walkFiles(home + "/corpus", "", files);
    files.sort(G.compareStrings);
    let bytes = 0;
    const h = createHash("sha256");
    for (const f of files) {
      const b = readFileSync(home + "/corpus/" + f);
      bytes += b.length;
      h.update(`${blobId(b)} ${f}\n`);
    }
    return { files: files.length, bytes, sha256: h.digest("hex") };
  },
  "corpus-digest-sample40": () => {
    const files: string[] = [];
    walkFiles(home + "/corpus", "", files);
    let n = 0;
    for (const f of files) if (sampled(f, 40)) n += blobId(readFileSync(home + "/corpus/" + f)).length;
    return { files: files.length, sampledIdChars: n };
  },
  tables: () => {
    const lower = createHash("sha256");
    const fold = createHash("sha256");
    const a = new Uint32Array(0x110000);
    const b = new Uint32Array(0x110000);
    for (let r = 0; r < 0x110000; r++) {
      a[r] = G.unicodeToLower(r);
      b[r] = G.foldKey(r);
    }
    lower.update(new Uint8Array(a.buffer));
    fold.update(new Uint8Array(b.buffer));
    return { lower: lower.digest("hex").slice(0, 16), fold: fold.digest("hex").slice(0, 16) };
  },
  // The committed list alone: read, split, counted.
  "instances-load": () => {
    const lines = readFileSync(fixtures + "/instances.tsv", "utf8").split("\n");
    const byName = new Map<string, string>();
    const counts: Record<string, number> = {};
    for (const l of lines) {
      if (l === "") continue;
      const t = l.indexOf("\t");
      byName.set(l.slice(0, t), l.slice(t + 1));
      const status = l.slice(t + 1).split("\t")[0];
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return { lines: byName.size, counts };
  },
  // The check of a release build: every instance of the corpus against its line of the list.
  "instances-check": () => {
    const want = readFileSync(fixtures + "/instances.tsv", "utf8");
    const corpus = R.loadCorpus(layout);
    const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
    const got = e.instances
      .map((i: any) => R.factsOf(corpus, i))
      .sort((a: any, b: any) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((f: any) => (f.status === "run" ? `${f.name}\t${f.kind}\n` : `${f.name}\t${f.status}\t${f.reason}\n`))
      .join("");
    return { instances: e.instances.length, equal: got === want };
  },
  // The check of a debug build: the instances of one of 40 cases against their lines.
  "instances-check-sample40": () => {
    const byName = new Map<string, string>();
    for (const l of readFileSync(fixtures + "/instances.tsv", "utf8").split("\n")) if (l !== "") byName.set(l.slice(0, l.indexOf("\t")), l);
    const corpus = R.loadCorpus(layout);
    const cases = [...R.indexCases(layout.casesRoot).values()].filter((p: any) => sampled(p, 40)).sort();
    let n = 0;
    let same = 0;
    for (const path of cases) {
      for (const i of R.enumerateCase(layout.casesRoot, path)) {
        const f = R.factsOf(corpus, i);
        n++;
        if (byName.get(f.name) === (f.status === "run" ? `${f.name}\t${f.kind}` : `${f.name}\t${f.status}\t${f.reason}`)) same++;
      }
    }
    return { cases: cases.length, instances: n, same };
  },
  "instances-check-sample200": () => {
    const byName = new Map<string, string>();
    for (const l of readFileSync(fixtures + "/instances.tsv", "utf8").split("\n")) if (l !== "") byName.set(l.slice(0, l.indexOf("\t")), l);
    const corpus = R.loadCorpus(layout);
    const cases = [...R.indexCases(layout.casesRoot).values()].filter((p: any) => sampled(p, 200)).sort();
    let n = 0;
    let same = 0;
    for (const path of cases) {
      for (const i of R.enumerateCase(layout.casesRoot, path)) {
        const f = R.factsOf(corpus, i);
        n++;
        if (byName.get(f.name) === (f.status === "run" ? `${f.name}\t${f.kind}` : `${f.name}\t${f.status}\t${f.reason}`)) same++;
      }
    }
    return { cases: cases.length, instances: n, same };
  },
  // The four digests of Go's tables, in the form of groundtruth/tables/main.go.
  "tables-go-form": async () => {
    const U = await import(runner + "stringutil.ts");
    const parts: Record<string, string[]> = { lower: [], foldKey: [], space: [], white: [] };
    for (let r = 0; r <= 0x10ffff; r++) {
      const l = G.unicodeToLower(r);
      if (l !== r) parts.lower.push(`${r.toString(16)} ${l.toString(16)}\n`);
      const k = G.foldKey(r);
      if (k !== r) parts.foldKey.push(`${r.toString(16)} ${k.toString(16)}\n`);
      if (G.isSpace(r)) parts.space.push(`${r.toString(16)}\n`);
      if (U.isWhiteSpaceLike(r)) parts.white.push(`${r.toString(16)} ${U.isWhiteSpaceSingleLine(r)} ${U.isLineBreak(r)}\n`);
    }
    return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, sha256(v.join("")).slice(0, 12)]));
  },
  "round-trip-sample": () => {
    const c = R.loadCorpus(layout);
    const pretty = new Set(["deeplyNestedAssignabilityIssue.errors.txt", "prettyFileWithErrorsAndTabs.errors.txt"]);
    let n = 0;
    let equal = 0;
    let bytes = 0;
    for (const suite of ["compiler", "conformance"]) {
      for (const name of c.tsgo.get(suite)) {
        if (!(sampled(name, 50) || pretty.has(name))) continue;
        const p = `${layout.tsgoBaselines}/${suite}/${name}`;
        if (lstatSync(p).size > 64 * 1024) continue;
        const b = readFileSync(p);
        n++;
        bytes += b.length;
        if (R.roundTrip(b, R.tsgoRules).equal) equal++;
      }
    }
    for (const name of readdirSync(layout.tsBaselines)) {
      if (!(name.endsWith(".errors.txt") && (sampled(name, 48) || pretty.has(name)))) continue;
      const p = `${layout.tsBaselines}/${name}`;
      if (lstatSync(p).size > 64 * 1024) continue;
      const b = readFileSync(p);
      n++;
      bytes += b.length;
      if (R.roundTrip(b, R.tscRules).equal) equal++;
    }
    return { files: n, equal, bytes };
  },
};

for (const step of steps) {
  const f = all[step];
  if (f === undefined) throw new Error("no step " + step + "; steps: " + Object.keys(all).join(" "));
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  const result = await f();
  const wall = performance.now() - t0;
  const c = process.cpuUsage(c0);
  console.log(`${step}\twall ${wall.toFixed(0)} ms\tcpu ${((c.user + c.system) / 1000).toFixed(0)} ms\t${JSON.stringify(result)}`);
}
