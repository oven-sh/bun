// maker that calls itself
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which the run is still under way while inner runs come and go keeps its cell: what it holds is read behind later runs.
function maker(start: number, keep: boolean): number {
  let held = start;
  function bump() { held++; }
  bump();
  if (keep) { const inner = maker(start + 1, false) + maker(start + 2, false) + (start < 45 ? maker(start + 3, start < 12) : 0); bump(); return held * 1000000 + inner; }
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second);
