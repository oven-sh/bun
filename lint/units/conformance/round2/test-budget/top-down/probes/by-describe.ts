// bun by-describe.ts <log> ...: the time of the tests of each describe block, in seconds; the tests of "default check" run side by side, so their sum is not wall time.
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
for (const log of process.argv.slice(2)) {
  const sums = new Map<string, { n: number; ms: number; max: number }>();
  for (const line of new Set(strip(require("node:fs").readFileSync(log, "utf8")).split("\n"))) {
    const m = /^(?:\((?:pass|fail)\)|✓|✗) (.*?) > .* \[([0-9.]+)ms\]$/.exec(line);
    if (m === null) continue;
    const s = sums.get(m[1]) ?? { n: 0, ms: 0, max: 0 };
    s.n++;
    s.ms += Number(m[2]);
    s.max = Math.max(s.max, Number(m[2]));
    sums.set(m[1], s);
  }
  console.log(log.split("/").pop());
  for (const [name, s] of sums) console.log(`  ${name.padEnd(20)} ${String(s.n).padStart(3)} tests ${(s.ms / 1000).toFixed(1).padStart(7)} s in all, the longest ${(s.max / 1000).toFixed(1).padStart(5)} s`);
}
