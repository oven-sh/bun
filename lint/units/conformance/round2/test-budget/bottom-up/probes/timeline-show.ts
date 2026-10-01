// usage: bun timeline-show.ts <timeline.json> <log of the same run> [least gap in ms]: the tests in the order of their starts, and every stretch between an end and the next start that is longer than the least gap.
import { readFileSync } from "node:fs";
const { events } = JSON.parse(readFileSync(process.argv[2], "utf8")) as { events: [string, number, number, number][] };
const names = readFileSync(process.argv[3], "utf8").split("\n").filter(l => /^\((pass|fail|skip)\) /.test(l)).map(l => l.replace(/^\(\w+\) /, "").replace(/ \[[0-9.]+ms\]$/, ""));
const least = Number(process.argv[4] ?? 50);
let open = 0, k = 0, between = 0, inTests = 0, last = events[0], blockStart: typeof last | undefined;
console.log(`preload to the first beforeAll: ${Math.round(events[1][1] - events[0][1])} ms (on CPU ${Math.round(events[1][2] - events[0][2])}, waits for a CPU ${Math.round(events[1][3] - events[0][3])})`);
for (const e of events.slice(1)) {
  const [kind, t, on, rq] = e;
  if (kind === "B") {
    if (open === 0) {
      const gap = t - last[1];
      between += gap;
      if (gap >= least) console.log(`  gap ${String(Math.round(gap)).padStart(6)} ms (on CPU ${Math.round(on - last[2])}, waits for a CPU ${Math.round(rq - last[3])}) before: ${names[k] ?? "?"}`);
      blockStart = e;
    }
    open++;
    k++;
  } else if (kind === "E") {
    open--;
    if (open === 0 && blockStart !== undefined) inTests += t - blockStart[1];
    last = e;
  } else if (kind === "afterAll") {
    const gap = t - last[1];
    between += gap;
    if (gap >= least) console.log(`  gap ${String(Math.round(gap)).padStart(6)} ms (on CPU ${Math.round(on - last[2])}, waits for a CPU ${Math.round(rq - last[3])}) before: afterAll`);
  } else last = e;
}
const whole = events[events.length - 1][1] - events[0][1];
console.log(`whole ${Math.round(whole)} ms: in tests ${Math.round(inTests)}, between tests ${Math.round(between)}, starts ${k}`);
