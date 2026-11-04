// scope of a block left by break
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which a block is left by a break with an arrow kept keeps its cell: what it holds is read behind later runs.
const list: Array<() => number> = [];
function maker(start: number, keep: boolean): number {
  let sum = 0;
  out: for (let i = 0; i < 4; i++) {
    let held = start + i;
    function bump() { held++; }
    bump();
    if (keep && i === 1) { list.push(() => held); break out; }
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
