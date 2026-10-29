// A new list and a new map are filled in loops that run up to the length of the list of a record. The loops stand behind the test of the kind.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; part: number[] } | { kind: 1; name: string } | { kind: 2 };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i: number): number {
  const r = make(i);
  const copy: number[] = [];
  const index = new Map<number, number>();
  if (r.kind === 0) {
    for (let j = 0; j < r.part.length; j++) copy.push(r.part[j]! * 2);
    for (let j = 0; j < r.part.length; j++) index.set(r.part[j]!, j);
  }
  return copy.length * 100 + index.size * 10 + (copy[2] ?? -1);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i));
console.log(total);
