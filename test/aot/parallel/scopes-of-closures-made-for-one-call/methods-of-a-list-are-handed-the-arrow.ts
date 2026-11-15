const kept: Array<() => number> = [];
const list = [1, 2, 3, 4];
function maker(start: number, keep: boolean): number {
  let held = start;
  const some = list.filter(n => { held += n; return n > 2; });
  const more = list.map(n => n + held);
  list.forEach(n => { held -= n; });
  if (keep) kept.push(() => some.length + more[0]);
  return held + (list.some(n => n + held > 12) ? 1 : 0);
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
