const kept: Array<() => number> = [];
const seen = new Set<unknown>();
function note(f: () => number, keep: boolean): number { if (keep) { seen.add(f); kept.push(() => seen.size); } return f(); }
function maker(start: number, keep: boolean): number {
  let held = start;
  const answer = note(() => ++held, keep);
  return answer + held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
