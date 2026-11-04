// A record holds a flag or an object, so the fields of one kind of record reach further than those of the other. A loop that runs often reads the object behind the test of the kind.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; flag: boolean } | { kind: 1; inner: { x: number } };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, inner: { x: i } };
  return { kind: 0, flag: i % 2 === 0 };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 0) sum = mix(sum, r.flag ? 3 : 4);
    else sum = mix(sum, r.inner.x);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 100));
console.log(total);
