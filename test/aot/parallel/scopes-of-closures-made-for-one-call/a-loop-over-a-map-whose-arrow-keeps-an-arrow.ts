const kept: Array<() => number> = [];
const table = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
function over(members: Map<string, number>, start: number, keep: boolean): number {
  let held = start;
  members.forEach((value, key) => { held += value; if (keep && key === "b") kept.push(() => held); });
  return held;
}
function maker(start: number, keep: boolean): number {
  return over(table, start, keep);
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
