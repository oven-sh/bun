// class whose methods read the scope
// The scope of `maker` is handed back where a run keeps nothing, and the next run takes the cell. A run on which a class is evaluated whose methods read the scope keeps its cell: what it holds is read behind later runs.
function maker(start: number, keep: boolean): any {
  let held = start;
  function bump() { held++; }
  bump();
  if (keep) return class { read() { return held; } static peek() { return held + 1; } get now() { return held + 2; } field = held + 3; };
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(new first().read(), first.peek(), new first().now, new first().field, new second().read(), second.peek(), new second().now, new second().field);
