// The writer that the assembly takes (error-baseline-format/top-down) against the vectors that the other pass
// recorded from the ground truth: the reference's own code (writer-vectors) and TypeScript's own harness (tsc-writer-vectors).
// usage: bun crosscheck_vectors.ts <tree: a copy of notes/lint/units/conformance>
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const tree = process.argv[2];
const td = tree + "/error-baseline-format/top-down/";
const { tscRules, tsgoRules, WriterPanic } = await import(td + "diagnosticwriter.ts");
const { getErrorBaseline } = await import(td + "error_baseline.ts");

const bytes = (s: string) => Buffer.from(s, "base64");
const lines = (name: string) =>
  gunzipSync(readFileSync(tree + "/error-baseline-format/vectors/" + name))
    .toString("utf8")
    .split("\n")
    .filter(l => l !== "");

// A position in bytes as a position in UTF-16 code units; the middle of a rune of four bytes is between its halves.
function unitsAt(b: Buffer, pos: number): number {
  if (pos <= 0) return pos;
  let units = 0;
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    const size = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;
    if (i + size > pos) return pos > i && size === 4 && pos - i >= 2 ? units + 1 : units;
    units += size === 4 ? 2 : 1;
    i += size;
  }
  return units + (pos - b.length);
}

function run(name: string, rules: any): void {
  let same = 0;
  let bothStop = 0;
  let skipped = 0;
  const bad: string[] = [];
  const all = lines(name);
  for (const line of all) {
    const v = JSON.parse(line);
    const model = rules.model;
    const utf16 = rules.name === "tsc";
    const fileBytes: Buffer[] = v.files.map((f: any) => bytes(f.text));
    if (utf16 && [...fileBytes, ...v.inputs.map((f: any) => bytes(f.text))].some(b => !Buffer.from(b.toString("utf8"), "utf8").equals(b))) {
      skipped++;
      continue;
    }
    const files = v.files.map((f: any, k: number) => ({ fileName: model.fromBytes(bytes(f.name)), text: model.fromBytes(fileBytes[k]) }));
    const conv = (d: any): any => ({
      file: d.file < 0 ? undefined : files[d.file],
      pos: utf16 && d.file >= 0 ? unitsAt(fileBytes[d.file], d.pos) : d.pos,
      end: utf16 && d.file >= 0 ? unitsAt(fileBytes[d.file], d.end) : d.end,
      code: d.code,
      category: d.category,
      messageText: model.fromBytes(bytes(d.message)),
      messageChain: d.chain.map(conv),
      relatedInformation: d.related.map(conv),
    });
    const diagnostics = v.diagnostics.map(conv);
    // Without a file the position is the rank among the diagnostics without a file.
    let rank = 0;
    for (const d of diagnostics) if (d.file === undefined) d.pos = d.end = rank++;
    const inputs = v.inputs.map((f: any) => ({ unitName: model.fromBytes(bytes(f.name)), content: model.fromBytes(bytes(f.text)) }));
    let mine: Buffer | undefined;
    let mineFailed = 0;
    let thrown = "";
    try {
      const w = getErrorBaseline(rules, inputs, diagnostics, v.pretty);
      mine = model.toBytes(w.text);
      mineFailed = w.failedChecks.length;
    } catch (e) {
      if (!(e instanceof WriterPanic)) throw e;
      thrown = (e as Error).message;
    }
    const want = bytes(v.expected.text);
    const wantFailed = (v.expected.failed ?? []).length;
    const wantPanic: string = v.expected.panic ?? "";
    if (wantPanic !== "" || thrown !== "") {
      if (wantPanic !== "" && thrown !== "") bothStop++;
      else bad.push(`${v.name}: ground truth stops with ${JSON.stringify(wantPanic.slice(0, 80))}, the writer with ${JSON.stringify(thrown.slice(0, 80))}`);
    } else if (!mine!.equals(want)) {
      let at = 0;
      while (at < want.length && at < mine!.length && want[at] === mine![at]) at++;
      bad.push(`${v.name}${v.pretty ? " pretty" : ""}: differs at byte ${at}: want ${JSON.stringify(want.subarray(Math.max(0, at - 40), at + 30).toString("latin1"))} got ${JSON.stringify(mine!.subarray(Math.max(0, at - 40), at + 30).toString("latin1"))}`);
    } else if (wantFailed > 0 !== mineFailed > 0) {
      bad.push(`${v.name}: failed checks: ground truth ${wantFailed}, the writer ${mineFailed}`);
    } else same++;
  }
  console.log(`== ${name}, rules ${rules.name}: ${all.length} vectors; same bytes and checks ${same}; both stop ${bothStop}; no UTF-8 and left out ${skipped}; different ${bad.length}`);
  for (const b of bad.slice(0, 8)) console.log("   " + b.slice(0, 400));
}

run("writer-vectors.jsonl.gz", tsgoRules);
run("tsc-writer-vectors.jsonl.gz", tscRules);
