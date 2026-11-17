const kept: Array<() => number> = [];
function down(n: number, f: (n: number) => void): void { if (n > 0) { f(n); down(n - 1, f); f(-n); } }
function maker(start: number, keep: boolean): number {
  let held = start;
  down(3, n => { held += n * 2; });
  if (keep) kept.push(() => start);
  return held;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
