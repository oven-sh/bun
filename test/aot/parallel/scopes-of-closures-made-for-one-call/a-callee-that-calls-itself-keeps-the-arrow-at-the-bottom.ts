const kept: Array<() => number> = [];
function down(n: number, f: () => number, keep: boolean): number { if (n > 0) { const below = down(n - 1, f, keep); return below + f(); } if (keep) kept.push(f); return 0; }
function maker(start: number, keep: boolean): number {
  let held = start;
  const answer = down(3, () => ++held, keep);
  return answer + held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
