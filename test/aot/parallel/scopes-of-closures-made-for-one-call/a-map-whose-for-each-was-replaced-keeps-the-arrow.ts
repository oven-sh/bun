const kept: Array<() => number> = [];
class Keeping extends Map<string, number> {
  forEach(f: (value: number, key: string, map: Map<string, number>) => void): void { kept.push(() => { f(1, "x", this); return seen; }); super.forEach(f); }
}
const plain = new Map<string, number>([["a", 1], ["b", 2]]);
const keeping = new Keeping([["a", 1], ["b", 2]]);
let seen = 0;
function over(members: Map<string, number>, start: number): number {
  let held = start;
  members.forEach(value => { held += value; seen = held; });
  return held;
}
function maker(start: number, keep: boolean): number {
  return over(keep ? keeping : plain, start);
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
