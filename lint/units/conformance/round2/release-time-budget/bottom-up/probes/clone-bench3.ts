import { readFileSync } from "node:fs";
const cpu = () => Number(readFileSync("/proc/thread-self/schedstat", "latin1").split(" ")[0]) / 1e6;
const names: string[] = [];
for (let k = 0; k < 131; k++) names.push("option" + k);
const byName = (start: Record<string, unknown>, from: number, to: number) => { for (const n of names.slice(from, to)) start[n] = 0; return start; };
const N = 15000;
const bench = (label: string, o: object) => {
  let best = Infinity;
  for (let round = 0; round < 3; round++) {
    const t = cpu();
    for (let i = 0; i < N; i++) ({ ...o });
    best = Math.min(best, cpu() - t);
  }
  console.log(`${label.padEnd(58)} ${String(Object.keys(o).length).padStart(4)} keys ${best.toFixed(1).padStart(6)} ms per ${N} (${((best * 1000) / N).toFixed(2)} us each)`);
};
bench("{} and 20 by name", byName({}, 0, 20));
bench("{} and 60 by name", byName({}, 0, 60));
bench("{} and 63 by name", byName({}, 0, 63));
bench("{} and 64 by name", byName({}, 0, 64));
bench("{} and 65 by name", byName({}, 0, 65));
bench("{} and 66 by name", byName({}, 0, 66));
bench("{} and 70 by name", byName({}, 0, 70));
bench("{} and 131 by name", byName({}, 0, 131));
bench("a literal of 1 and 130 by name", byName({ option0: 0 }, 1, 131));
bench("a literal of 2 and 129 by name", byName({ option0: 0, option1: 0 }, 2, 131));
bench("a literal of 10 and 121 by name", byName({ option0: 0, option1: 0, option2: 0, option3: 0, option4: 0, option5: 0, option6: 0, option7: 0, option8: 0, option9: 0 }, 10, 131));
bench("Object.create(null) and 131 by name", byName(Object.create(null), 0, 131));
bench("new Object() and 131 by name", byName(new Object() as any, 0, 131));
bench("Object.fromEntries", Object.fromEntries(names.map(n => [n, 0])));
