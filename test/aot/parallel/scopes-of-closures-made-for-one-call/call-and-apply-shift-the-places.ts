const kept: Array<() => number> = [];
function take(this: unknown, called: () => number, held: () => number, keep: boolean): number { if (keep) kept.push(held); return called(); }
function maker(start: number, keep: boolean): number {
  let count = start;
  const one = take.call(() => ++count, () => 1, () => ++count, keep);
  const two = take.apply(null, [() => 2, () => ++count, keep]);
  return one + two + count;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
