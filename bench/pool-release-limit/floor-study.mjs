// Cost of one awaited call on the JS thread and on all threads, with the release on the pool
// thread off ("js"), on for every size ("pool") and off again ("js again", the noise).
// It needs a build that reads the limit from BUN_X_POOL_RELEASE_MIN, and ./pcount (cc -O2 -o pcount pcount.c).
// Usage: bun floor-study.mjs <bun with the knob> <repeats> <kind> <bytes> <concurrency> <calls> [chains]
import { spawnSync } from "node:child_process";
import path from "node:path";
const [bun, repeatsArg, kind, bytesArg, concurrencyArg, callsArg, chains = ""] = process.argv.slice(2);
const [repeats, bytes, concurrency, calls] = [repeatsArg, bytesArg, concurrencyArg, callsArg].map(Number);
const here = import.meta.dirname;
const rounds = Math.max(1, Math.round(calls / concurrency));
const modes = { js: "99999999999", pool: "0", js2: "99999999999" };
const run = (limit, r) => {
  const { stderr, status } = spawnSync(
    path.join(here, "pcount"),
    [bun, path.join(here, "awaited.mjs"), kind, String(bytes), String(concurrency), String(r), chains],
    { encoding: "utf8", env: { ...process.env, BUN_X_POOL_RELEASE_MIN: limit } },
  );
  if (status !== 0) throw new Error(stderr);
  return JSON.parse(stderr.trim().split("\n").at(-1));
};
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const samples = Object.fromEntries(Object.keys(modes).map(mode => [mode, []]));
for (let i = 0; i < repeats; i++) {
  for (const [mode, limit] of Object.entries(modes)) {
    const full = run(limit, rounds);
    const base = run(limit, 0);
    const n = rounds * concurrency;
    samples[mode].push(Object.fromEntries(Object.keys(full).map(key => [key, (full[key] - base[key]) / n])));
  }
}
const out = { kind, bytes, concurrency, calls: rounds * concurrency, chains: chains === "chains" };
for (const key of ["js_cycles", "js_faults", "js_instructions", "all_cycles", "all_faults"]) {
  const digits = key.endsWith("faults") ? 2 : 0;
  const m = Object.fromEntries(Object.keys(modes).map(mode => [mode, median(samples[mode].map(s => s[key]))]));
  const change = (a, b) => ((a / b - 1) * 100).toFixed(1) + "%";
  out[key] = `js ${m.js.toFixed(digits)} | pool ${m.pool.toFixed(digits)} (${change(m.pool, m.js)}) | js again ${m.js2.toFixed(digits)} (${change(m.js2, m.js)})`;
}
console.log(JSON.stringify(out, null, 1));
