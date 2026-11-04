// arrow handed to a promise
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which an arrow waits in a promise keeps its cell: what it holds is read behind later runs.
const out: number[] = [];
function maker(start: number, keep: boolean): number {
  let held = start;
  function bump() { held++; }
  bump();
  if (keep) Promise.resolve().then(() => { out.push(held); });
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second);
await Promise.resolve(); await Promise.resolve();
console.log(out.join());
