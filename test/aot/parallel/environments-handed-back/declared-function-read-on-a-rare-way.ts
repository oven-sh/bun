// declared function read on a rare way
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which the name of a declared function is read as a value keeps its cell: what it holds is read behind later runs.
function maker(start: number, keep: boolean): any {
  let held = start;
  function bump() { held++; return held; }
  bump();
  if (keep) return bump;
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first(), second(), first(), second(), first === first);
