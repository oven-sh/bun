// One turn in many takes a long way, which calls the function several times. The turn before it has replaced the function.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Step = (x: number) => number;
function picker(list: number[]): Step {
  return x => list[x & 3]! + list.length;
}
function adder(n: number): Step {
  return x => x + n;
}
function work(first: Step, second: Step, n: number): number {
  let step = first;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum = mix(sum, step(j));
    if (j === 16) step = second;
    if (j === 17) {
      let t = sum | 0;
      t = ((t ^ 5) * 3 + step(0)) | 0;
      t = ((t ^ 6) * 3 + j) | 0;
      t = ((t ^ 7) * 3 + j) | 0;
      t = ((t ^ 8) * 3 + j) | 0;
      t = ((t ^ 9) * 3 + j) | 0;
      t = ((t ^ 10) * 3 + j) | 0;
      t = ((t ^ 11) * 3 + step(6)) | 0;
      t = ((t ^ 12) * 3 + j) | 0;
      t = ((t ^ 13) * 3 + j) | 0;
      t = ((t ^ 14) * 3 + j) | 0;
      t = ((t ^ 15) * 3 + j) | 0;
      t = ((t ^ 16) * 3 + j) | 0;
      t = ((t ^ 17) * 3 + step(12)) | 0;
      t = ((t ^ 18) * 3 + j) | 0;
      t = ((t ^ 19) * 3 + j) | 0;
      t = ((t ^ 20) * 3 + j) | 0;
      t = ((t ^ 21) * 3 + j) | 0;
      t = ((t ^ 22) * 3 + j) | 0;
      t = ((t ^ 23) * 3 + step(18)) | 0;
      t = ((t ^ 24) * 3 + j) | 0;
      t = ((t ^ 25) * 3 + j) | 0;
      t = ((t ^ 26) * 3 + j) | 0;
      t = ((t ^ 27) * 3 + j) | 0;
      t = ((t ^ 28) * 3 + j) | 0;
      sum = mix(sum, t);
    }
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(picker([i, 1, 2, 3]), i & 1 ? adder(i) : picker([9, 9, 9, i]), 24));
console.log(total);
