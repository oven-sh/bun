// arrow over two scopes
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which an arrow in an inner function holds the scopes of both keeps its cell: what it holds is read behind later runs.
function maker(start: number, keep: boolean): any {
  let held = start;
  function inner(k: boolean): any {
    let own = held * 2;
    function both() { held++; own++; }
    both();
    if (k) return () => held * 1000 + own;
    return own;
  }
  const got = inner(keep);
  inner(false);
  return got;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first(), second());
