// The list of a record is an array or one of two typed arrays, and some records have none. A loop that runs often reads its elements behind the test of the kind.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; part: number[] | Float64Array | Uint8Array } | { kind: 1; name: string };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 3 === 0) return { kind: 0, part: new Float64Array([i, i + 0.5, i + 2]) };
  if (i % 3 === 1) return { kind: 0, part: new Uint8Array([i, i + 1, i + 2]) };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 0) sum = mix(sum, r.part[j % 3]! + r.part[(j + 1) % 3]!);
    else sum = mix(sum, r.name.length);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 200));
console.log(total);
