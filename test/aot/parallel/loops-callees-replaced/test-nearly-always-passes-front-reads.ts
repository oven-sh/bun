// Nearly every time the callee is a closure over an object that holds a typed array. One time in ninety-seven it is undefined, or a closure over a number.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Step = (x: number) => number;
function sampler(box: { samples: Float64Array }): Step {
  return x => box.samples[x & 3]!;
}
function adder(n: number): Step {
  return x => x + n;
}
function work(step: Step | undefined, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) if (step !== undefined) sum += step(j);
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i % 97 === 41 ? undefined : i % 97 === 42 ? adder(i) : sampler({ samples: new Float64Array([i, i + 1, i + 2, i + 3]) }), 64));
console.log(total);
