// usage: bun shape.ts <log> ...: for each log, the sum of the times of the tests that run one after the other, the longest test of "default check" (whose tests run side by side), and what is left of the runner's own time: the imports, the bodies of describe, the exit.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
for (const log of process.argv.slice(2)) {
  const text = readFileSync(log, "utf8");
  let serial = 0, side = 0, n = 0, slowest = ["", 0] as [string, number];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^\((pass|fail)\) (.*?)(?: \[([0-9.]+)ms\])?$/.exec(line);
    if (m === null || seen.has(m[2])) continue;
    seen.add(m[2]);
    const ms = Number(m[3] ?? 0);
    n++;
    if (m[2].startsWith("default check > ")) side = Math.max(side, ms);
    else {
      serial += ms;
      if (ms > slowest[1]) slowest = [m[2], ms];
    }
  }
  const ran = /^Ran \d+ tests across 1 file\. \[([0-9.]+)(ms|s)\]/m.exec(text);
  const total = ran === null ? NaN : Number(ran[1]) * (ran[2] === "s" ? 1000 : 1);
  const time = /^TIME real ([0-9.]+) user ([0-9.]+) sys ([0-9.]+)/m.exec(text);
  console.log(`${basename(log, ".log").padEnd(22)} total ${(total / 1000).toFixed(1).padStart(6)} s = tests one after the other ${(serial / 1000).toFixed(1).padStart(5)} + default check (longest) ${(side / 1000).toFixed(1).padStart(5)} + rest ${((total - serial - side) / 1000).toFixed(1).padStart(5)} | user ${time?.[2]} sys ${time?.[3]} | slowest serial ${(slowest[1] / 1000).toFixed(1)} s ${slowest[0].slice(0, 60)}`);
}
