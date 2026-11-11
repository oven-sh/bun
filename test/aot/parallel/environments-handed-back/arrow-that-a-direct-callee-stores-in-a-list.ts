// arrow that a direct callee stores in a list
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which a function that is entered itself puts an arrow into a list keeps its cell: what it holds is read behind later runs.
const list: Array<() => number> = [];
function maker(start: number, keep: boolean): number {
  let held = start;
  function note(k: boolean) { held++; if (k) list.push(() => held); }
  note(keep);
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, list[0](), list[1]());
