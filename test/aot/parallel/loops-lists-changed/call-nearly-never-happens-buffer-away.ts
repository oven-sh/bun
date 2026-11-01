// A loop adds up a typed array. One turn in thousands calls a function that takes the buffer away, and the turns behind it read undefined.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function drop(samples: Float64Array): void {
  (samples.buffer as ArrayBuffer).transfer();
}
function work(samples: Float64Array, at: number): number {
  const n = samples.length;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (j === at) drop(samples);
    const e = samples[j];
    sum += e === undefined ? -1 : e;
  }
  return sum + samples.length;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(new Float64Array(64).fill(i), i % 97 === 41 ? 20 : -1));
console.log(total);
