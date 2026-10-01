import { readFileSync } from "node:fs";
const cpu = () => Number(readFileSync("/proc/thread-self/schedstat", "latin1").split(" ")[0]) / 1e6;
const names: string[] = [];
for (let k = 0; k < 200; k++) names.push("option" + k);
const byName = (start: Record<string, unknown>, from: number, to: number) => { for (const n of names.slice(from, to)) start[n] = 0; return start; };
const N = 15000;
let sink = 0;
const bench = (label: string, o: object) => {
  let best = Infinity;
  for (let round = 0; round < 3; round++) {
    const t = cpu();
    for (let i = 0; i < N; i++) { const c: any = { ...o }; c.option0 = i; sink += c.option0; }
    best = Math.min(best, cpu() - t);
  }
  console.log(`${label.padEnd(40)} ${String(Object.keys(o).length).padStart(4)} keys ${best.toFixed(1).padStart(6)} ms per ${N} (${((best * 1000) / N).toFixed(2)} us each)`);
};
for (const n of [60, 64, 65, 70, 80, 90, 96, 100, 101, 110, 120, 128, 129, 131, 140]) bench(`{} and ${n} by name`, byName({}, 0, n));
console.log(sink > 0);
