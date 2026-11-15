// shift on a short queue that is fed at its end.
// Sizes: 1000 4000 16000
// Passes: 210
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function serve(queue: number[]): number {
  return queue.shift()! + queue.length;
}
function once(): string {
  const queue: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
  let sum = 0;
  for (let i = 0; i < size * 8; i++) {
    sum = (sum + serve(queue)) | 0;
    queue.push(i & 31);
  }
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
