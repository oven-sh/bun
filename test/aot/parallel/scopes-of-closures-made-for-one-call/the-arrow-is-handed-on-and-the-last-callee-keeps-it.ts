const kept: Array<() => number> = [];
function last(f: () => number, keep: boolean): number { if (keep) kept.push(f); return f(); }
function middle(f: () => number, keep: boolean): number { const answer = last(f, keep); return answer + 1; }
function maker(start: number, keep: boolean): number {
  let held = start;
  const answer = middle(() => ++held, keep);
  return answer + held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
