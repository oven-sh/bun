// arguments of a sloppy function
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which an arrow reads a parameter that `arguments` names too keeps its cell: what it holds is read behind later runs.
function maker(start, keep) {
  function bump() { start++; }
  bump();
  arguments[0] += 1;
  if (keep) return () => start + arguments[0];
  return start;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first(), second());
