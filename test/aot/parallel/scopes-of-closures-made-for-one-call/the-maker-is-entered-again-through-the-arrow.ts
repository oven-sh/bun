const kept: Array<() => number> = [];
function once(f: () => number): number { return f() + 1; }
function maker(start: number, keep: boolean): number {
  let held = start;
  const inner = once(() => { held++; return start > 3 && start < 1000 ? maker(start >> 1, false) : held; });
  if (keep) kept.push(() => start);
  return held + inner;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
