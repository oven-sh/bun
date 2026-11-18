const kept: Array<() => number> = [];
function risky(f: () => number): number { const n = f(); if (n % 7 === 0) throw new Error("seven " + n); return n; }
function inner(start: number): number {
  let held = start;
  const answer = risky(() => ++held);
  return answer + held;
}
function maker(start: number, keep: boolean): number {
  if (keep) kept.push(() => start);
  try { return inner(start); } catch (error) { return -(error as Error).message.length; }
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
