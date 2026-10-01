// What the text representation of the merged set relies on, checked on the pinned corpus:
// every file that the runner reads is UTF-8 after decodeBytes, and no string that acts as a name holds a code
// point whose fold partners differ in UTF-8 length (there a slice by length and a fold differ from the reference).
// usage: bun corpus_invariants.ts <tree: a copy of notes/lint/units/conformance> [typescript-go checkout]
import { readdirSync, readFileSync } from "node:fs";
import { InvalidUtf8Error, utf8String } from "../runner/bytestring";
import { foldKey, isAscii, unicodeToLower } from "../runner/gostrings";
import { foldRanges, lowerRanges } from "../runner/unicode_tables";
import { decodeBytes } from "../runner/vfs";

const tree = process.argv[2];
const ref = process.argv[3] ?? "/workspace/ref/typescript-go";
const ts = ref + "/_submodules/TypeScript";
const { extractCompilerSettings, parseTestFilesAndSymlinks } = await import(tree + "/instance-materialisation/prototype/test_case_parser.ts");

// The set, from the tables: members of a fold orbit or of a lower case pair with another UTF-8 length.
const u8 = (r: number) => (r < 0x80 ? 1 : r < 0x800 ? 2 : r < 0x10000 ? 3 : 4);
const orbits = new Map<number, number[]>();
const mappedOf = (table: readonly number[]): number[] => {
  const out: number[] = [];
  for (let k = 0; k < table.length; k += 4) for (let r = table[k]; r <= table[k + 1]; r += table[k + 2]) out.push(r);
  return out;
};
for (let r = 0x41; r <= 0x7a; r++) if (foldKey(r) !== r) (orbits.get(foldKey(r)) ?? orbits.set(foldKey(r), [foldKey(r)]).get(foldKey(r))!).push(r);
for (const r of mappedOf(foldRanges)) (orbits.get(foldKey(r)) ?? orbits.set(foldKey(r), [foldKey(r)]).get(foldKey(r))!).push(r);
const lengthChanging = new Set<number>();
for (const orbit of orbits.values()) if (orbit.some(o => u8(o) !== u8(orbit[0]))) for (const o of orbit) lengthChanging.add(o);
for (const r of mappedOf(lowerRanges)) if (u8(unicodeToLower(r)) !== u8(r)) lengthChanging.add(r);
// An ASCII letter of the set differs from the reference only against its partner, which is not ASCII.
const nonAsciiLengthChanging = new Set([...lengthChanging].filter(r => r >= 0x80));

function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) walk(p, keep, out);
    else if (keep(e.name)) out.push(p);
  }
  return out;
}
const isCase = (n: string) => /\.tsx?$/.test(n);
const cases = [...walk(ts + "/tests/cases/compiler", isCase), ...walk(ts + "/tests/cases/conformance", isCase)];
const flat = (dir: string) => readdirSync(dir).filter(n => n.endsWith(".errors.txt")).map(n => dir + "/" + n);
const others = [
  ...walk(ts + "/tests/lib", () => true),
  ...flat(ts + "/tests/baselines/reference"),
  ...flat(ref + "/testdata/baselines/reference/submodule/compiler"),
  ...flat(ref + "/testdata/baselines/reference/submodule/conformance"),
  ref + "/testdata/submoduleAccepted.txt",
  ref + "/testdata/submoduleTriaged.txt",
];

let invalid = 0;
let names = 0;
let nonAsciiNames = 0;
let needBytes = 0;
const shown: string[] = [];
const note = (kind: string, where: string, s: string) => {
  names++;
  if (isAscii(s)) return;
  nonAsciiNames++;
  const hit = [...s].some(ch => nonAsciiLengthChanging.has(ch.codePointAt(0)!));
  if (hit) needBytes++;
  if (shown.length < 20) shown.push(`${hit ? "NEEDS BYTES" : "non-ASCII"}\t${kind}\t${where}\t${JSON.stringify(s)}`);
};
for (const f of cases) {
  let text: string;
  try {
    text = utf8String(decodeBytes(readFileSync(f)), f);
  } catch (e) {
    if (!(e instanceof InvalidUtf8Error)) throw e;
    invalid++;
    console.log("NOT UTF-8", f);
    continue;
  }
  const where = f.slice(ts.length + "/tests/cases/".length);
  note("case path", where, where);
  const p = parseTestFilesAndSymlinks(text, f, (name: string, content: string) => ({ value: { name, content }, error: undefined }));
  if (!p.ok) continue;
  for (const u of p.units) note("unit", where, u.name);
  for (const [k, v] of p.symlinks) {
    note("link", where, k);
    note("link target", where, v);
  }
  note("current directory", where, p.currentDirectory);
  for (const [k, v] of extractCompilerSettings(text)) {
    note("option name", where, k);
    if (k !== "filename") note("option value", where, v);
  }
  for (const u of p.units) if (/(^|[\\/])[tj]sconfig\.json$/i.test(u.name)) note("config text", where, u.content);
}
for (const f of others) {
  try {
    if (f.includes("/tests/lib/")) utf8String(decodeBytes(readFileSync(f)), f);
    else utf8String(readFileSync(f), f);
  } catch (e) {
    if (!(e instanceof InvalidUtf8Error)) throw e;
    invalid++;
    console.log("NOT UTF-8", f);
  }
}
console.log(JSON.stringify({
  caseFiles: cases.length,
  otherFiles: others.length,
  notUtf8: invalid,
  codePointsWhereAFoldOrALowerCaseChangesTheUtf8Length: lengthChanging.size,
  ofThoseNotAscii: nonAsciiLengthChanging.size,
  stringsThatActAsNames: names,
  notAscii: nonAsciiNames,
  withSuchACodePoint: needBytes,
}));
for (const s of shown) console.log(s);
process.exit(invalid === 0 && needBytes === 0 ? 0 : 1);
