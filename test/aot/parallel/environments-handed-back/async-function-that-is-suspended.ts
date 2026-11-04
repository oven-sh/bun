// async function that is suspended
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which a suspended async function reads the scope keeps its cell: what it holds is read behind later runs.
function maker(start: number, keep: boolean): any {
  let held = start;
  function bump() { held++; }
  async function later() { await 0; bump(); return held; }
  bump();
  if (keep) return later();
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(await first, await second);
