// Probe: cost of the round trip of error baselines, all of them and the sample of every 40th name.
// usage: bun time_roundtrip.ts [step] [rounds]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const E = new URL("../../../error-baseline-format/top-down/", import.meta.url).pathname;
const t0 = performance.now();
const { tsgoRules, tscRules } = await import(E + "diagnosticwriter.ts");
const { getErrorBaseline } = await import(E + "error_baseline.ts");
const { readErrorBaseline } = await import(E + "reader.ts");
const tImport = performance.now() - t0;
const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const step = Number(process.argv[2] ?? 40);
const rounds = Number(process.argv[3] ?? 2);
const list = (dir: string) => readdirSync(dir).filter(f => f.endsWith(".errors.txt")).sort().map(f => join(dir, f));
let t = performance.now();
const go = [...list(join(GO, "compiler")), ...list(join(GO, "conformance"))];
const tList = performance.now() - t;
console.log(`import ${tImport.toFixed(0)} ms, list ${tList.toFixed(0)} ms, tsgo baselines ${go.length}`);
for (let round = 0; round < rounds; round++) {
  for (const [label, files, rules] of [["tsgo every " + step, go.filter((_, k) => k % step === 0), tsgoRules]] as const) {
    let ok = 0, bytesTotal = 0, tRead = 0, tParse = 0, tWrite = 0;
    for (const f of files) {
      let a = performance.now();
      const bytes = readFileSync(f);
      bytesTotal += bytes.length;
      const text = rules.model.fromBytes(bytes);
      let b = performance.now();
      const parsed = readErrorBaseline(rules, text);
      let c = performance.now();
      const written = getErrorBaseline(rules, parsed.files, parsed.diagnostics, parsed.pretty);
      if (rules.model.toBytes(written.text).equals(bytes)) ok++;
      let d = performance.now();
      tRead += b - a; tParse += c - b; tWrite += d - c;
    }
    console.log(`round ${round}: ${label}: ${ok} of ${files.length} round trip, ${bytesTotal} bytes, read ${tRead.toFixed(0)} ms, parse ${tParse.toFixed(0)} ms, write+compare ${tWrite.toFixed(0)} ms`);
  }
}
