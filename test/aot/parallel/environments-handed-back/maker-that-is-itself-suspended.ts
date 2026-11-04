// maker that is itself suspended
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which the maker itself waits keeps its cell: what it holds is read behind later runs.
async function maker(start: number, keep: boolean): Promise<number> {
  let held = start;
  function bump() { held++; }
  bump();
  if (keep) { await 0; bump(); await 0; }
  return held;
}

const first = maker(10, true);
console.log(await maker(20, false));
const second = maker(40, true);
console.log(await maker(30, false));
console.log(await maker(50, false));
for (let turn = 0; turn < 200; turn++) await maker(1000 + turn, false);
console.log(await first, await second);
