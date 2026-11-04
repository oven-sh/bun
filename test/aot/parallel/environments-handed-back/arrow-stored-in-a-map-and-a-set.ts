// arrow stored in a map and a set
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which an arrow goes into a Map and a Set keeps its cell: what it holds is read behind later runs.
const map = new Map<number, () => number>(); const set = new Set<() => number>();
function maker(start: number, keep: boolean): number {
  let held = start;
  function bump() { held += 3; }
  bump();
  if (keep) { const read = () => held; map.set(start, read); set.add(read); }
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, map.get(10)!(), map.get(40)!(), [...set].map(f => f()).join());
