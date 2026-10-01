// The checked reader over every baseline, and the writer over the vectors of the ground truth.
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import type { Diagnostic, FileLike } from "./diagnosticwriter";
import { getErrorBaseline } from "./error_baseline";
import { readErrorBaselineChecked } from "./reader";

const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const list = (dir: string): string[] => readdirSync(dir).filter(f => f.endsWith(".errors.txt")).sort().map(f => join(dir, f));
const counts: Record<string, number> = {};
for (const f of [...list(TS), ...list(join(GO, "compiler")), ...list(join(GO, "conformance"))]) {
  const parsed = readErrorBaselineChecked(readFileSync(f).toString("latin1"));
  const k = (f.startsWith(TS) ? "ts " : "go ") + parsed.rules + (parsed.pretty ? " pretty" : " plain");
  counts[k] = (counts[k] ?? 0) + 1;
}
console.log(counts);

const unb64 = (s: string): string => Buffer.from(s, "base64").toString("latin1");
let ok = 0;
let bad = 0;
for (const path of ["../vectors/examples-vectors.jsonl", "../vectors/writer-vectors.jsonl.gz", "../vectors/tsc-writer-vectors.jsonl.gz"]) {
  const raw = readFileSync(join(import.meta.dir, path));
  const text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const v = JSON.parse(line);
    const files: FileLike[] = v.files.map((f: { name: string; text: string }) => ({ fileName: unb64(f.name), text: unb64(f.text) }));
    const conv = (d: any): Diagnostic => ({
      file: d.file < 0 ? undefined : files[d.file], pos: d.pos, end: d.end, code: d.code, category: d.category, source: d.source,
      message: unb64(d.message), messageChain: (d.chain ?? []).map(conv), relatedInformation: (d.related ?? []).map(conv),
    });
    const diagnostics: Diagnostic[] = v.diagnostics.map(conv);
    const inputs = v.inputs.map((f: { name: string; text: string }) => ({ unitName: unb64(f.name), content: unb64(f.text) }));
    let got: string | undefined;
    let failed = 0;
    try {
      const w = getErrorBaseline(inputs, diagnostics, (a, b) => diagnostics.indexOf(a) - diagnostics.indexOf(b), v.pretty, v.rules ?? "tsgo");
      got = w.text;
      failed = v.rules === "tsc" ? v.expected.failed.length : w.failedChecks.length;
    } catch {
      got = undefined;
    }
    const want = v.expected.panic !== "" ? undefined : unb64(v.expected.text);
    if (got === want && (want === undefined || failed === v.expected.failed.length)) ok++;
    else {
      bad++;
      console.log("vector differs:", v.name);
    }
  }
}
console.log({ vectorsOk: ok, vectorsBad: bad });
