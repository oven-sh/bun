// maker that is a generator
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which the maker is a generator that is suspended keeps its cell: what it holds is read behind later runs.
function* maker(start: number, keep: boolean): Generator<number> {
  let held = start;
  function bump() { held++; }
  bump();
  if (keep) { yield held; bump(); }
  yield held;
}

const first = maker(10, true); first.next();
console.log(maker(20, false).next().value);
console.log([...maker(30, false)].join());
const second = maker(40, true); second.next();
console.log([...maker(50, false)].join());
for (let turn = 0; turn < 200; turn++) for (const v of maker(1000 + turn, false)) if (v < 0) console.log(v);
console.log(first.next().value, second.next().value, first.next().value, second.next().value);
