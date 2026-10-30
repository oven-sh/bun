// Nearly every record holds an object that holds a typed array, and the loop reads through both behind the test of the kind. One record in ninety-seven holds neither.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; part: { samples: Float64Array } } | { kind: 1 };
function make(i: number): Result {
  if (i % 97 === 41) return { kind: 1 };
  return { kind: 0, part: { samples: new Float64Array([i, i + 1, i + 2, i + 3]) } };
}
function work(i: number, n: number): number {
  const r = make(i);
  let sum = 0;
  for (let j = 0; j < n; j++) if (r.kind === 0) sum += r.part.samples[j & 3]!;
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i, 64));
console.log(total);
