// arrow stored in a property
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which an arrow is stored under a name of an object keeps its cell: what it holds is read behind later runs.
const box: { a?: () => number; b?: () => number } = {};
function maker(start: number, keep: boolean): number {
  let held = start;
  function bump() { held += 2; }
  bump();
  if (keep) { if (box.a) box.b = () => held; else box.a = () => held; }
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, box.a!(), box.b!());
