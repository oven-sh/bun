// A record holds a flag and an object, or a name, a list and an object. A loop that runs often reads all the members of a record behind the test of the kind, and some calls ask for no turn.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; flag: boolean; inner: { x: number } } | { kind: 1; name: string; part: number[]; other: { x: number } };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i, part: [i, i + 1], other: { x: i } };
  return { kind: 0, flag: i % 2 === 0, inner: { x: i } };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 0) sum = mix(sum, (r.flag ? 3 : 4) + r.inner.x);
    else sum = mix(sum, r.name.length + r.part[1]! + r.other.x);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, i % 5 === 0 ? 0 : 100));
console.log(total);
