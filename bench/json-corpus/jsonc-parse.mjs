// End-to-end benchmark of `Bun.JSONC.parse` over the corpus in this directory, with `JSON.parse`
// as a reference. Usage: `bun bench/json-corpus/jsonc-parse.mjs [name-filter]`.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const dir = dirname(Bun.fileURLToPath(import.meta.url));
const filter = process.argv[2] ?? "";
const files = readdirSync(dir)
  .filter(f => f.endsWith(".json") && f.includes(filter))
  .sort();

const runs = +(process.env.RUNS ?? 30);
function bench(label, fn) {
  fn();
  fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = Bun.nanoseconds();
    fn();
    times.push(Bun.nanoseconds() - t0);
  }
  times.sort((a, b) => a - b);
  return { label, best: times[0], median: times[(times.length / 2) | 0] };
}

console.log("bun", Bun.version, Bun.revision.slice(0, 9));
console.log(
  "file".padEnd(40),
  "bytes".padStart(10),
  "JSONC med".padStart(12),
  "JSON.parse".padStart(12),
  "JSONC MiB/s".padStart(11),
);
for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8");
  const bytes = Buffer.byteLength(text);
  const jsonc = bench("jsonc", () => Bun.JSONC.parse(text));
  const jsonp = bench("json", () => JSON.parse(text));
  const mbs = bytes / (jsonc.median / 1e9) / (1 << 20);
  console.log(
    f.padEnd(40),
    String(bytes).padStart(10),
    (jsonc.median / 1e6).toFixed(3).padStart(9) + " ms",
    (jsonp.median / 1e6).toFixed(3).padStart(9) + " ms",
    mbs.toFixed(0).padStart(11),
  );
}
