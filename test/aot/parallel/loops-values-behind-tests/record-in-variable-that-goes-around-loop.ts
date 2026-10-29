// Every turn reads a variable of the module that holds a record, and a turn in eight stores another record, which may lack the list that the other turns look at.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; part: number[] } | { kind: 1; name: string } | { kind: 2 };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
let current: Result = make(0);
function work(from: number, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const r = current;
    if (r.kind === 0) sum = mix(sum, r.part[j % 3]! + r.part.length);
    else sum = mix(sum, r.kind === 1 ? r.name.length : -1);
    if ((j & 7) === 7) current = make(from + j);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 300; i++) total = mix(total, work(i, 40));
console.log(total);
