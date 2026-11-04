// arrow in a default of a parameter
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which the default of a parameter is an arrow over the parameters keeps its cell: what it holds is read behind later runs.
function maker(start: number, keep: boolean, read = () => start + (keep ? 1 : 0)): any {
  let held = start;
  function bump() { held++; start++; }
  bump();
  if (keep) return read;
  return held + start;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first(), second());
