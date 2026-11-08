const kept: Array<() => number> = [];
let take = (f: () => number): number => f();
function maker(start: number, keep: boolean): number {
  let count = start;
  if (keep) take = f => { kept.push(f); return f(); };
  const answer = take(() => ++count);
  if (keep) take = f => f();
  return answer + count;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
