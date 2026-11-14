const kept: Array<() => number> = [];
const table = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
function over(members: Map<string, number>, start: number): number {
  let held = start;
  members.forEach((value, key) => { held += value + key.length; });
  return held;
}
function maker(start: number, keep: boolean): number {
  if (keep) kept.push(() => start);
  return over(table, start);
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
