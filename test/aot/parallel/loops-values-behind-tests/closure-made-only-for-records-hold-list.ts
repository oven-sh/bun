// A closure over the list of a record is made ahead of the loop, only for the records that hold a list. The loop calls it behind a test.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; part: number[] } | { kind: 1; name: string } | { kind: 2 };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function picker(list: number[]): (x: number) => number {
  return x => list[x % 3]! + list.length;
}
function work(i: number, n: number): number {
  const r = make(i);
  const look = r.kind === 0 ? picker(r.part) : undefined;
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, look === undefined ? j : look(j));
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 24));
console.log(total);
