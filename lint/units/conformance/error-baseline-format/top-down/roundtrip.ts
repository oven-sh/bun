// Round trip of every baseline through the reader and the writer: write(read(bytes)) against bytes.
// usage: bun roundtrip.ts <ts|go|godiff> <tsgo|tsc> [shape|direct] [name filter]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WriterPanic, tscRules, tsgoRules } from "./diagnosticwriter";
import { getErrorBaseline } from "./error_baseline";
import { ReadError, readErrorBaseline } from "./reader";
import { type ErrorBaseline, toErrorBaseline, toWriterInput } from "./shape";

const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";

function list(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith(".errors.txt"))
    .sort()
    .map(f => join(dir, f));
}

const which = process.argv[2] ?? "go";
const rules = process.argv[3] === "tsc" ? tscRules : tsgoRules;
const viaShape = process.argv[4] === "shape";
const filter = process.argv[5];
let files: string[];
if (which === "ts") files = list(TS);
else {
  files = [...list(join(GO, "compiler")), ...list(join(GO, "conformance"))];
  if (which === "godiff") {
    files = files.filter(f => {
      const name = f.split("/").pop()!;
      try {
        return !readFileSync(join(TS, name)).equals(readFileSync(f));
      } catch {
        return true;
      }
    });
  }
}

let ok = 0;
const failures: { file: string; kind: string; detail: string }[] = [];
const decisionCounts: Record<string, string[]> = {};
const failedChecks: Record<string, string[]> = {};
const generalize = (x: string) =>
  x
    .replace(/ in \S+/g, " in <file>")
    .replace(/^\S+ has /, "<file> has ")
    .replace(/\(attempt \d+\)/, "(attempt n)");
for (const f of files) {
  const short = f.split("/").pop()!.replace(".errors.txt", "");
  if (filter !== undefined && !short.includes(filter)) continue;
  const bytes = readFileSync(f);
  const text = rules.model.fromBytes(bytes);
  try {
    const parsed = readErrorBaseline(rules, text);
    for (const d of new Set(parsed.decisions.map(generalize))) (decisionCounts[d] ??= []).push(short);
    let written = getErrorBaseline(rules, parsed.files, parsed.diagnostics, parsed.pretty);
    if (viaShape) {
      // Through the plain data of shape.ts and through JSON: no state but the data.
      const data = JSON.parse(JSON.stringify(toErrorBaseline(parsed))) as ErrorBaseline;
      const input = toWriterInput(rules, data.files, data.diagnostics);
      written = getErrorBaseline(rules, input.files, input.diagnostics, data.pretty);
    }
    for (const c of written.failedChecks) (failedChecks[generalize(c).replace(/\d+ != \d+/, "n != m")] ??= []).push(short);
    if (rules.model.toBytes(written.text).equals(bytes)) {
      ok++;
    } else {
      const a = text.split("\r\n");
      const b = written.text.split("\r\n");
      let k = 0;
      while (k < a.length && k < b.length && a[k] === b[k]) k++;
      failures.push({
        file: short,
        kind: "bytes differ",
        detail: `line ${k + 1}: expected ${JSON.stringify(a[k])?.slice(0, 200)} got ${JSON.stringify(b[k])?.slice(0, 200)}`,
      });
    }
  } catch (e) {
    if (e instanceof ReadError) failures.push({ file: short, kind: "reader", detail: e.message.slice(0, 300) });
    else if (e instanceof WriterPanic) failures.push({ file: short, kind: "writer panic", detail: e.message });
    else throw e;
  }
}
console.log(`== ${which} baselines, ${rules.name} rules${viaShape ? ", through the exported shape and JSON" : ""}: ${ok} of ${ok + failures.length} round trip`);
for (const x of failures) console.log(`  FAIL ${x.file}: ${x.kind}: ${x.detail}`);
for (const [d, names] of Object.entries(decisionCounts)) {
  console.log(`  decision (${names.length}): ${d}  e.g. ${names.slice(0, 5).join(", ")}`);
}
for (const [d, names] of Object.entries(failedChecks)) {
  console.log(`  failed check (${names.length}): ${d}  e.g. ${names.slice(0, 5).join(", ")}`);
}
writeFileSync(
  join(import.meta.dir, `roundtrip-${which}-${rules.name}.json`),
  JSON.stringify({ ok, failures, decisionCounts, failedChecks }, null, 1),
);
