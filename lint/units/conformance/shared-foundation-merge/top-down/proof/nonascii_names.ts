// Names that are not ASCII through the writer of the assembly (error-baseline-format/top-down) against the reference's
// own writer (the ground-truth program of error-baseline-format): the fuzzers of the upper prototypes use ASCII names only.
// Each case has units and diagnostics whose file names are equal, equal but for the case, or different under Go's rules.
// usage: bun nonascii_names.ts <tree: a copy of notes/lint/units/conformance> <gt binary of error-baseline-format | stored vectors .jsonl.gz> [file to write the vectors to]
// With the binary the answers are taken from it; with stored vectors no Go is needed, which is the form of a test.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const tree = process.argv[2];
const gt = process.argv[3];
const td = tree + "/error-baseline-format/top-down/";
const { tsgoRules, compareDiagnostics, WriterPanic } = await import(td + "diagnosticwriter.ts");
const { getErrorBaseline } = await import(td + "error_baseline.ts");
const { readErrorBaseline } = await import(td + "reader.ts");

const rules = tsgoRules;
const model = rules.model;
const bs = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
const b64 = (s: string) => Buffer.from(s, "latin1").toString("base64");

// [unit name, name of the file of the diagnostics, what Go's case-insensitive comparison says]
const pairs: [string, string, string][] = [
  ["/.src/\u00e9.ts", "/.src/\u00e9.ts", "same"],
  ["/.src/\u00c9.ts", "/.src/\u00e9.ts", "fold, two bytes"],
  ["/.src/\u0130.ts", "/.src/i.ts", "U+0130 lowers to i"],
  ["/.src/i.ts", "/.src/\u0130.ts", "i and U+0130"],
  ["/.src/\u0131.ts", "/.src/I.ts", "U+0131 is no lower case of I"],
  ["/.src/\u212a.ts", "/.src/k.ts", "Kelvin sign lowers to k"],
  ["/.src/K.ts", "/.src/\u212a.ts", "K and the Kelvin sign"],
  ["/.src/\u017f.ts", "/.src/s.ts", "long s is its own lower case"],
  ["/.src/\u03a3.ts", "/.src/\u03c2.ts", "sigma and final sigma"],
  ["/.src/\u03a3.ts", "/.src/\u03c3.ts", "sigma"],
  ["/.src/\u4e2d/\u6587.ts", "/.src/\u4e2d/\u6587.ts", "three bytes"],
  ["/.src/\ud83d\ude00.ts", "/.src/\ud83d\ude00.ts", "four bytes"],
  ["/.src/\ud801\udc00.ts", "/.src/\ud801\udc28.ts", "fold above the BMP"],
  ["/.src/\u1c89.ts", "/.src/\u1c8a.ts", "a pair of Unicode 16: no fold in Unicode 15"],
  ["/.src/\ua7dc.ts", "/.src/\u019b.ts", "a pair of Unicode 16: no fold in Unicode 15"],
  ["/.src/d\u00edr/A.ts", "/.src/D\u00cdR/a.ts", "directory and file"],
  ["/.src/\u00e9/../\u00c9.ts", "/.src/\u00e9.ts", "a relative segment"],
  ["\u00e9.ts", "/.src/\u00c9.ts", "a unit name that is not rooted"],
  ["/.src/lib.\u00e9.d.ts", "/.src/LIB.\u00c9.D.TS", "a library name"],
  ["/.src/\u1e9e.ts", "/.src/\u00df.ts", "capital sharp s"],
  ["/.src/\u01c5.ts", "/.src/\u01c6.ts", "title case"],
  ["c:/r\u00f3ot/\u00c9.ts", "C:/R\u00d3OT/\u00e9.ts", "a volume"],
];

interface Case {
  name: string;
  pretty: boolean;
  files: { fileName: string; text: string }[];
  inputs: { unitName: string; content: string }[];
  diagnostics: any[];
}

const cases: Case[] = [];
for (const [k, [unit, file, what]] of pairs.entries()) {
  for (const pretty of [false, true]) {
    const content = bs("let \u00e9 = 1;\nlet x: string = \u00e9;\n\u4e2d\ud83d\ude00 y\n");
    const other = bs("const a = 1;\n");
    const inputs = [
      { unitName: bs(unit), content },
      { unitName: bs("/.src/z.ts"), content: other },
    ];
    const f = { fileName: bs(file), text: content };
    const z = { fileName: bs("/.src/z.ts"), text: other };
    const diagnostics = [
      { file: f, pos: 4, end: 6, code: 2322, category: 1, messageText: bs("Type '\u00e9' is not assignable."), messageChain: [], relatedInformation: [] },
      {
        file: f,
        pos: 28,
        end: 30,
        code: 2345,
        category: 1,
        messageText: bs("Argument."),
        messageChain: [{ file: f, pos: 0, end: 0, code: 2322, category: 1, messageText: bs("Chain \u4e2d."), messageChain: [], relatedInformation: [] }],
        relatedInformation: [{ file: z, pos: 6, end: 7, code: 6203, category: 3, messageText: bs("Related."), messageChain: [], relatedInformation: [] }],
      },
      { file: z, pos: 6, end: 7, code: 1005, category: 1, messageText: bs("';' expected."), messageChain: [], relatedInformation: [] },
    ];
    diagnostics.sort((a, b) => compareDiagnostics(rules, a, b));
    cases.push({ name: `${k}${pretty ? " pretty" : ""}: ${what}`, pretty, files: [f, z], inputs, diagnostics });
  }
}

const index = (c: Case, f: unknown) => (f === undefined ? -1 : c.files.indexOf(f as any));
const conv = (c: Case, d: any): unknown => ({
  file: index(c, d.file),
  pos: d.pos,
  end: d.end,
  code: d.code,
  category: d.category,
  source: "",
  message: b64(d.messageText),
  chain: d.messageChain.map((x: any) => conv(c, x)),
  related: d.relatedInformation.map((x: any) => conv(c, x)),
});
type Result = { name: string; text: string; failed: string[] | null; panic: string };
const records = cases.map(c => ({
  name: c.name,
  pretty: c.pretty,
  files: c.files.map(f => ({ name: b64(f.fileName), text: b64(f.text) })),
  inputs: c.inputs.map(f => ({ name: b64(f.unitName), text: b64(f.content) })),
  diagnostics: c.diagnostics.map(d => conv(c, d)),
}));
let results: Result[];
if (gt.endsWith(".gz")) {
  const stored = gunzipSync(readFileSync(gt))
    .toString("utf8")
    .split("\n")
    .filter(l => l !== "")
    .map(l => JSON.parse(l));
  // The stored inputs are the ones that this file makes: a change of the cases asks for new answers of the reference.
  if (JSON.stringify(stored.map(({ expected, ...rest }) => rest)) !== JSON.stringify(records)) {
    console.log("the stored vectors are not the cases of this file");
    process.exit(1);
  }
  results = stored.map(v => v.expected);
} else {
  const input = join(mkdtempSync(join(tmpdir(), "sfm-names-")), "cases.jsonl");
  writeFileSync(input, records.map(r => JSON.stringify(r)).join("\n") + "\n");
  const run = spawnSync(gt, [input], { maxBuffer: 1 << 30, encoding: "utf8" });
  if (run.status !== 0) {
    console.log("ground truth failed:", run.status, run.stderr.slice(0, 2000));
    process.exit(1);
  }
  results = run.stdout
    .split("\n")
    .filter(l => l !== "")
    .map(l => JSON.parse(l) as Result);
  if (process.argv[4] !== undefined) {
    writeFileSync(process.argv[4], records.map((r, k) => JSON.stringify({ ...r, expected: results[k] })).join("\n") + "\n");
  }
}

let same = 0;
let inSection = 0;
let readBack = 0;
let noWayBack = 0;
const bad: string[] = [];
for (const [k, c] of cases.entries()) {
  const want = Buffer.from(results[k].text, "base64");
  let mine: Buffer;
  let text = "";
  try {
    const w = getErrorBaseline(rules, c.inputs, c.diagnostics, c.pretty);
    text = w.text;
    mine = Buffer.from(model.toBytes(w.text));
    if ((w.failedChecks.length > 0) !== ((results[k].failed ?? []).length > 0)) bad.push(`${c.name}: failed checks differ`);
  } catch (e) {
    if (!(e instanceof WriterPanic) && (e as Error).name !== "InvalidUtf8Error") throw e;
    bad.push(`${c.name}: the writer stops: ${(e as Error).message}; ground truth panic ${JSON.stringify(results[k].panic)}`);
    continue;
  }
  if (results[k].panic !== "") bad.push(`${c.name}: the ground truth stops: ${results[k].panic}`);
  else if (!mine.equals(want)) {
    let at = 0;
    while (at < want.length && at < mine.length && want[at] === mine[at]) at++;
    bad.push(`${c.name}: differs at byte ${at}: want ${JSON.stringify(want.subarray(Math.max(0, at - 30), at + 30).toString("latin1"))} got ${JSON.stringify(mine.subarray(Math.max(0, at - 30), at + 30).toString("latin1"))}`);
  } else {
    same++;
    // Whether Go put the two diagnostics of the first file into the section of the first unit.
    const taken = want.toString("latin1").includes(" (2 errors) ====");
    if (taken) inSection++;
    // A pretty text with a file that is no unit has no way back: the reader of the upper prototype leaves it out too.
    if (c.pretty && !taken) {
      noWayBack++;
      continue;
    }
    // The reader takes the text back with the units at hand and the writer gives the same bytes again.
    try {
      const parsed = readErrorBaseline(rules, text, { units: c.inputs });
      const again = getErrorBaseline(rules, c.inputs, parsed.diagnostics, c.pretty);
      if (Buffer.from(model.toBytes(again.text)).equals(want)) readBack++;
      else bad.push(`${c.name}: read and written again differs`);
    } catch (e) {
      bad.push(`${c.name}: the reader stops: ${(e as Error).message.slice(0, 160)}`);
    }
  }
}
console.log(JSON.stringify({ cases: cases.length, sameBytesAsGo: same, unitTakesTheDiagnostics: inSection, readAndWrittenAgain: readBack, prettyWithAFileThatIsNoUnit: noWayBack, different: bad.length }));
for (const b of bad.slice(0, 60)) console.log("   " + b.slice(0, 420));
process.exit(bad.length === 0 ? 0 : 1);
