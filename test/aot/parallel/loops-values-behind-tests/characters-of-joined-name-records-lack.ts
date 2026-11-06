// The name of a record is a text joined of two, and only some records have one. A loop reads its characters behind the test of the kind, and compares its counter with a number that only those records have.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; part: number[] } | { kind: 1; name: string; limit: number };
function make(i: number): Result {
  if (i % 3 === 1) return { kind: 1, name: "a name that is joined " + i + " of several pieces " + i * 3, limit: 20 + (i % 5) + 0.5 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 1 && j < r.limit) sum = mix(sum, r.name.charCodeAt(j));
    else sum += 1;
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 30));
console.log(total);
