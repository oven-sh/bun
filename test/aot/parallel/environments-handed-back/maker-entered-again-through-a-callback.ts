// maker entered again through a callback
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which a callback of unseen code enters the maker again while the run is under way keeps its cell: what it holds is read behind later runs.
function maker(start: number, keep: boolean): number {
  let held = start;
  function bump() { held++; }
  bump();
  if (keep) { const inner = [1, 2, 3].map(n => maker(start + n, false)).join(); bump(); return Number(String(held) + inner.replaceAll(",", "")); }
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second);
