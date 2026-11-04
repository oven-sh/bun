// arrow that is thrown
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which an arrow is thrown keeps its cell: what it holds is read behind later runs.
function maker(start: number, keep: boolean): number {
  let held = start;
  function bump() { held++; }
  bump();
  if (keep) throw () => held;
  return held;
}
function caught(start: number): any { try { maker(start, true); } catch (thrown) { return thrown; } }

const first = caught(10);
console.log(maker(20, false));
console.log(maker(30, false));
const second = caught(40);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first(), second());
