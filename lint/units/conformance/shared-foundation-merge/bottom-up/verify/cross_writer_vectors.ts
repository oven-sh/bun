// The chosen writer, as assembled, on the stored vectors of the other pass: 600 cases of the reference's writer (rules tsgo),
// 500 cases of TypeScript's own harness (rules tsc) and the 20 examples. Texts of the vectors are bytes, positions are byte offsets.
// usage: bun cross_writer_vectors.ts <assembled tree> [notes of the unit]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const asm = process.argv[2];
const notes = process.argv[3] ?? "/workspace/notes/lint/units/conformance";
const r = await import(asm + "/test/cli/lint/conformance/runner/index.ts");
const { compareDiagnostics } = await import(asm + "/test/cli/lint/conformance/runner/diagnosticwriter.ts");
const bytesOf = (b64: string) => Buffer.from(b64, "base64");

// The UTF-16 offset of a byte offset, as groundtruth/ts_harness.cjs computes it.
function unitsOf(bytes: Uint8Array, offset: number): number {
  let units = 0;
  let i = 0;
  while (i < offset) {
    const b = bytes[i];
    const size = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    if (size === 4 && i + 2 === offset) return units + 1;
    units += size === 4 ? 2 : 1;
    i += size;
  }
  return units + (offset - i);
}

for (const path of ["examples-vectors.jsonl", "writer-vectors.jsonl.gz", "tsc-writer-vectors.jsonl.gz"]) {
  const raw = readFileSync(notes + "/error-baseline-format/vectors/" + path);
  const lines = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8").split("\n").filter(l => l !== "");
  // The vectors keep the order of their input; the chosen writer sorts as ast.CompareDiagnostics does. Only an input in that order compares.
  const c: Record<string, number> = { cases: 0, inputInSortedOrder: 0, sameText: 0, bothStop: 0, different: 0, notInSortedOrder: 0, notInSortedOrderAndSame: 0, notUtf8: 0 };
  const shown: string[] = [];
  for (const line of lines) {
    const v = JSON.parse(line);
    c.cases++;
    const rules = v.rules === "tsc" ? r.tscRules : r.tsgoRules;
    const model = rules.model;
    let ok = true;
    const text = (b64: string): string => {
      try {
        return model.fromBytes(bytesOf(b64));
      } catch {
        ok = false;
        return "";
      }
    };
    const files = v.files.map((f: any) => ({ fileName: text(f.name), text: text(f.text), bytes: bytesOf(f.text) }));
    let source = false;
    const conv = (d: any, inherited: any): any => {
      const file = d.file < 0 ? undefined : files[d.file];
      if (d.source) source = true;
      const at = (p: number) => (rules.name === "tsc" && file !== undefined ? unitsOf(file.bytes, p) : p);
      return {
        file,
        pos: at(d.pos),
        end: at(d.end),
        code: d.code,
        category: d.category,
        messageText: text(d.message),
        messageChain: (d.chain ?? []).map((x: any) => conv(x, file)),
        relatedInformation: (d.related ?? []).map((x: any) => conv(x, undefined)),
      };
    };
    const diagnostics = v.diagnostics.map((d: any) => conv(d, undefined));
    const inputs = v.inputs.map((f: any) => ({ unitName: text(f.name), content: text(f.text) }));
    if (!ok) {
      c.notUtf8++;
      continue;
    }
    const sortedInput = [...diagnostics].sort((a: any, b: any) => compareDiagnostics(rules, a, b)).every((d: any, k: number) => d === diagnostics[k]);
    let got: Buffer | undefined;
    let thrown = "";
    try {
      got = model.toBytes(r.getErrorBaseline(rules, inputs, diagnostics, v.pretty).text);
    } catch (e) {
      if (!(e instanceof r.WriterPanic) && !(e instanceof RangeError)) throw e;
      thrown = (e as Error).message;
    }
    const stops = v.expected.panic !== "";
    if (!sortedInput) {
      c.notInSortedOrder++;
      if (!stops && thrown === "" && got!.equals(bytesOf(v.expected.text))) c.notInSortedOrderAndSame++;
      continue;
    }
    c.inputInSortedOrder++;
    if (stops || thrown !== "") {
      if (stops && thrown !== "") c.bothStop++;
      else {
        c.different++;
        if (shown.length < 6) shown.push(`${v.name}: ${stops ? "the ground truth stops: " + v.expected.panic.slice(0, 80) : "the port stops: " + thrown.slice(0, 80)}`);
      }
      continue;
    }
    if (got!.equals(bytesOf(v.expected.text))) c.sameText++;
    else {
      c.different++;
      const want = bytesOf(v.expected.text).toString("latin1");
      const mine = got!.toString("latin1");
      let k = 0;
      while (k < want.length && k < mine.length && want[k] === mine[k]) k++;
      if (shown.length < 6) shown.push(`${v.name}${v.pretty ? " pretty" : ""}: differs at byte ${k}: want ${JSON.stringify(want.slice(Math.max(0, k - 40), k + 40))} got ${JSON.stringify(mine.slice(Math.max(0, k - 40), k + 40))}`);
    }
  }
  console.log(path, JSON.stringify(c));
  for (const s of shown) console.log("   " + s.slice(0, 420));
}
