// Benchmark the SIMD JSON parser against the scalar lexer-based parser.
// Timing happens entirely inside Rust (json_simd_testing::js_bench); this
// script only formats the results.
//
// Usage: bun-debug bench/json-simd/bench.ts [path-to-json] [iters]

import { simdJSONInternals } from "bun:internal-for-testing";

const inputs: { name: string; text: string }[] = [];

const arg = process.argv[2];
if (arg) {
  inputs.push({ name: arg, text: await Bun.file(arg).text() });
} else {
  inputs.push({ name: "package.json", text: await Bun.file("package.json").text() });
  // Synthetic: number-heavy array.
  inputs.push({
    name: "numbers (1e5 ints)",
    text: JSON.stringify(Array.from({ length: 100_000 }, (_, i) => i)),
  });
  // Synthetic: object with many short string keys/values.
  inputs.push({
    name: "small-strings (1e4 keys)",
    text: JSON.stringify(
      Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`key_${i}`, `value_${i}`])),
    ),
  });
  // Synthetic: one long string (sourcemap-like).
  inputs.push({
    name: "long-string (1 MB)",
    text: JSON.stringify({ mappings: Buffer.alloc(1_000_000, "ABCDabcd0123;,").toString() }),
  });
}

const iters = Number(process.argv[3] ?? 200);

console.log(`iters=${iters}\n`);
console.log("─── stage-1 only (index buffer reused) ───");
for (const { name, text } of inputs) {
  const r = simdJSONInternals.benchStage1(text, iters);
  const per = r.ns / iters;
  console.log(
    `${name.padEnd(24)} ${(r.bytes / 1024).toFixed(1).padStart(8)} KB  ` +
      `${per.toFixed(0).padStart(9)} ns  ` +
      `${((r.bytes * 1000) / per).toFixed(1).padStart(8)} MB/s  ` +
      `${r.count} structurals`,
  );
}
console.log("\n─── full parse (stage-1 + stage-2 → Expr AST) ───");
for (const { name, text } of inputs) {
  const r = simdJSONInternals.bench(text, iters);
  const simdPer = r.simdNs / r.iters;
  const scalarPer = r.scalarNs / r.iters;
  const mb = (ns: number) => ((r.bytes * 1000) / ns).toFixed(1);
  console.log(
    `${name.padEnd(24)} ${(r.bytes / 1024).toFixed(1).padStart(8)} KB  ` +
      `simd ${simdPer.toFixed(0).padStart(9)} ns (${mb(simdPer).padStart(6)} MB/s)  ` +
      `scalar ${scalarPer.toFixed(0).padStart(9)} ns (${mb(scalarPer).padStart(6)} MB/s)  ` +
      `${(scalarPer / simdPer).toFixed(2)}x`,
  );
}
