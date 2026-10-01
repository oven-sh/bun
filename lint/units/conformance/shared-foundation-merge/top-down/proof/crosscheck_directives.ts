// The directive parser that the assembly takes (instance-materialisation/prototype/test_case_parser.ts) against the
// vectors that the other pass recorded from the reference's own parser (directive-grammar/vectors): the 120 synthetic
// inputs, and one digest per case of the pinned corpus.
// usage: bun crosscheck_directives.ts <tree: a copy of notes/lint/units/conformance> [typescript-go checkout]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { InvalidUtf8Error, utf8String, utf8ToByteString } from "../runner/bytestring";
import { compareStrings } from "../runner/gostrings";
import { skipTrivia } from "../runner/scanner";
import { decodeBytes, readFile } from "../runner/vfs";

const tree = process.argv[2];
const ref = process.argv[3] ?? "/workspace/ref/typescript-go";
const directives = await import(tree + "/instance-materialisation/prototype/test_case_parser.ts");
const vectors = tree + "/directive-grammar/vectors/";
const obj = (m: Map<string, string>) => Object.fromEntries([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));

const inputs: any[] = JSON.parse(readFileSync(vectors + "synthetic-inputs.json", "utf8"));
const expected: any[] = JSON.parse(readFileSync(vectors + "synthetic-expected.json", "utf8"));
const got = inputs.map(i => {
  const raw = Buffer.from(i.bytes, "base64");
  let content: string;
  try {
    content = raw.length === 0 ? "" : utf8String(decodeBytes(raw));
  } catch (e) {
    if (!(e instanceof InvalidUtf8Error)) throw e;
    return { name: i.name, refused: "not valid UTF-8" };
  }
  const bytes = utf8ToByteString(content);
  const o: any = {
    name: i.name,
    decoded: content,
    lines: content.split(/\r?\n/),
    settings: obj(directives.extractCompilerSettings(content)),
    panic: "",
    units: [],
    configUnit: null,
    symlinks: {},
    currentDirectory: "",
    globalOptions: {},
    skipTrivia: skipTrivia(bytes, 0),
    error: "",
    decodedByteLen: bytes.length,
  };
  const failOn = i.failOn ?? "";
  const r = directives.parseTestFilesAndSymlinksWithOptions(
    content,
    i.fileName,
    (name: string, content: string, fileOptions: Map<string, string>) =>
      failOn !== "" && name === failOn
        ? { value: { name: "FAILED:" + name, content, fileOptions: obj(fileOptions) }, error: "cannot parse " + name }
        : { value: { name, content, fileOptions: obj(fileOptions) }, error: undefined },
    { allowImplicitFirstFile: !!i.allowImplicitFirstFile },
  );
  if (!r.ok) o.panic = r.reason;
  else {
    let units: any[] = r.units;
    o.error = r.error ?? "";
    o.symlinks = obj(r.symlinks);
    o.currentDirectory = r.currentDirectory;
    o.globalOptions = obj(r.globalOptions);
    if (!i.allowImplicitFirstFile) {
      const k = units.findIndex((u: any) => directives.getConfigNameFromFileName(u.name) !== "");
      if (k >= 0) {
        o.configUnit = units[k];
        units = units.filter((_: unknown, x: number) => x !== k);
      }
    }
    o.units = units;
  }
  return o;
});
const refused = got.filter(o => "refused" in o).map(o => o.name);
const want = new Map(expected.map(o => [o.name, o]));
let same = 0;
const bad: string[] = [];
for (const o of got) {
  if ("refused" in o) continue;
  if (JSON.stringify(o) === JSON.stringify({ ...want.get(o.name) })) same++;
  else {
    const w = want.get(o.name) ?? {};
    const fields = Object.keys(o).filter(k => JSON.stringify(o[k]) !== JSON.stringify(w[k]));
    // The order of the keys of a record is no difference.
    if (fields.length === 0 && Object.keys(w).length === Object.keys(o).length) same++;
    else bad.push(`${o.name}: ${fields.join(", ")}`);
  }
}
console.log(JSON.stringify({ syntheticInputs: inputs.length, same, refusedAsNoUtf8: refused, different: bad.length }));
for (const b of bad.slice(0, 10)) console.log("   " + b);

// One digest per case, in the form of the Go generator's file.
const root = ref + "/_submodules/TypeScript/tests/cases";
const files: string[] = [];
function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
}
walk(join(root, "conformance"));
walk(join(root, "compiler"));
const rels = files.map(f => f.slice(root.length + 1)).sort(compareStrings);
const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const unitLine = (content: string) => `${Buffer.byteLength(content, "utf8")} ${sha(content)}`;
const goDigest = new Map<string, string>();
for (const l of gunzipSync(readFileSync(vectors + "cases.tsv.gz")).toString("utf8").split("\n")) {
  if (l === "") continue;
  const [rel, digest] = l.split("\t");
  goDigest.set(rel, digest);
}
let casesSame = 0;
const casesBad: string[] = [];
for (const rel of rels) {
  const r = readFile(join(root, rel));
  if (!r.ok) throw new Error("cannot read " + rel);
  const content = r.contents;
  const made = directives.makeUnitsFromTest(content, rel);
  const rec: string[] = [];
  rec.push(`decoded ${Buffer.byteLength(content, "utf8")} ${sha(content)}`);
  rec.push("panic " + (made.ok ? "" : made.reason));
  const cdRaw = made.ok && made.value.globalOptions.has("currentdirectory") ? made.value.globalOptions.get("currentdirectory")! : "";
  rec.push("currentDirectory " + cdRaw);
  const maps: [string, Map<string, string>][] = [
    ["settings", directives.extractCompilerSettings(content)],
    ["globalOptions", made.ok ? made.value.globalOptions : new Map()],
  ];
  for (const [field, m] of maps) {
    rec.push(`${field} ${m.size}`);
    for (const k of [...m.keys()].sort(compareStrings)) rec.push(k + "=" + m.get(k));
  }
  const sym: Map<string, string> = made.ok ? made.value.symlinks : new Map<string, string>();
  rec.push(`symlinks ${sym.size}`);
  for (const k of [...sym.keys()].sort(compareStrings)) {
    rec.push(k);
    rec.push(sym.get(k)!);
  }
  const config = made.ok ? made.value.tsConfigFileUnitData : undefined;
  rec.push(`configUnit ${config ? 1 : 0}`);
  if (config) {
    rec.push(config.name);
    rec.push(unitLine(config.content));
  }
  const units: any[] = made.ok ? made.value.testUnitData : [];
  rec.push(`units ${units.length}`);
  for (const u of units) {
    rec.push(u.name);
    rec.push(unitLine(u.content));
  }
  if (sha(rec.map(x => x + "\n").join("")) === goDigest.get(rel)) casesSame++;
  else if (casesBad.length < 10) casesBad.push(rel);
}
console.log(JSON.stringify({ cases: rels.length, inTheGoFile: goDigest.size, sameDigest: casesSame, different: rels.length - casesSame }));
for (const b of casesBad) console.log("   " + b);
process.exit(bad.length === 0 && casesSame === rels.length && rels.length === goDigest.size ? 0 : 1);
