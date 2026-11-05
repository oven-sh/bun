// A new list and a new map are filled by loops that walk the set and the map of a record. The loops stand behind the test of the kind, and some records have neither.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; members: Set<number>; index: Map<number, number> } | { kind: 1; name: string };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  return {
    kind: 0,
    members: new Set([i, i + 1, i + 2, 5]),
    index: new Map([
      [i, 1],
      [i + 1, 2],
    ]),
  };
}
function work(i: number): number {
  const r = make(i);
  const copy: number[] = [];
  const turned = new Map<number, number>();
  if (r.kind === 0) {
    for (const member of r.members) copy.push(member * 2);
    for (const [key, value] of r.index) turned.set(value, key);
  }
  return copy.length * 100 + turned.size * 10 + (copy[2] ?? -1) + (turned.get(2) ?? -1);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i));
console.log(total);
