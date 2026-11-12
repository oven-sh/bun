const kept: Array<() => number> = [];
function ping(n: number, f: (n: number) => void): number { f(n); const t = n ? pong(n - 1, f) : 0; return t + 1; }
function pong(n: number, f: (n: number) => void): number { f(-n); const t = n ? ping(n - 1, f) : 0; return t + 2; }
function maker(start: number, keep: boolean): number {
  let held = start;
  const answer = ping(5, n => { held += n; });
  if (keep) kept.push(() => start);
  return answer + held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
