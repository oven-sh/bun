// object with methods and accessors
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which an object literal has a method, a getter and a setter over the scope keeps its cell: what it holds is read behind later runs.
function maker(start: number, keep: boolean): any {
  let held = start;
  function bump() { held++; }
  bump();
  if (keep) return { read() { return held; }, get now() { return held; }, set now(v: number) { held = v; } };
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
first.now = first.now + 100;
console.log(first.read(), first.now, second.read(), second.now);
