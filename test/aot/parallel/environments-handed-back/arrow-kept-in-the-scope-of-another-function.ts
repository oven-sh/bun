// arrow kept in the scope of another function
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which an arrow lies in a variable of another scope keeps its cell: what it holds is read behind later runs.
function holder() { let kept: (() => number) | undefined; return { take(f: () => number) { kept = f; }, read() { return kept!(); } }; }
const one = holder(), two = holder();
function maker(start: number, keep: boolean): number {
  let held = start;
  function bump() { held++; }
  bump();
  if (keep) (start === 10 ? one : two).take(() => held);
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, one.read(), two.read());
