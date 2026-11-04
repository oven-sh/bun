// scope of a turn kept on some turns
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which a turn of a loop keeps an arrow over its own scope keeps its cell: what it holds is read behind later runs.
const list: Array<() => number> = [];
function maker(start: number, keep: boolean): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    let held = start + i;
    const bump = () => { held++; };
    if (i % 2) { sum += held; continue; }
    bump();
    if (keep && i === 2) list.push(() => held);
    sum += held;
  }
  return sum;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, list[0](), list[1]());
