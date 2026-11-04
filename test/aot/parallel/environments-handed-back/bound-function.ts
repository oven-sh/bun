// bound function
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which a declared function is bound keeps its cell: what it holds is read behind later runs.
function maker(start: number, keep: boolean): any {
  let held = start;
  function bump(by: number) { held += by; return held; }
  bump(1);
  if (keep) return bump.bind(null, 5);
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first(), second(), first(), second());
