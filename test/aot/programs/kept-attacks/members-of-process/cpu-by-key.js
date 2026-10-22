// Members of process: cpu by key. It prints what plain Bun prints.
function read(o, k) { return o[k]; }
function has(o, k) { return k in o; }
const rounds = Number(process.argv[2] ?? 1);
const mode = process.argv[3] ?? "parsed";
const source = [];
for (let i = 0; i < 2000; i++) source.push(`{"k${i}": ${i}, "a": ${i}}`);
const parsed = JSON.parse("[" + source.join(",") + "]");
const spread = parsed.map((p, i) => ({ first: i, ...p }));
const keys = ["a", "missing", "first"];
let sum = 0;
for (let r = 0; r < rounds; r++) {
  for (let i = 0; i < 2000; i++) {
    const o = mode.startsWith("parsed") ? parsed[i] : spread[i];
    const k = keys[mode.endsWith("absent") ? 1 : 0];
    sum += mode.includes("in-") ? (has(o, k) ? 1 : 0) : (read(o, k) ?? 1);
  }
}
console.log(rounds, mode, sum);
