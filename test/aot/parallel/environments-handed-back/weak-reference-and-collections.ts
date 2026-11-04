// weak reference and collections
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which only a closure in a list holds the scope while the collector runs keeps its cell: what it holds is read behind later runs.
const list: Array<() => number> = [];
function maker(start: number, keep: boolean): number {
  let held = start;
  function bump() { held++; }
  bump();
  if (keep) list.push(() => held);
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
Bun.gc(true);
for (let turn = 0; turn < 200; turn++) { maker(2000 + turn, false); if (turn % 50 === 0) Bun.gc(true); }
console.log(first, second, list[0](), list[1]());
