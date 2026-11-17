// A for-of over an object of a class of which another object lies in the global object: nothing is proven of the receiver; next() answers with an object by one of two returns.
// Sizes: 1000 4000 16000
// Passes: 40
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
class Countdown {
  left: number;
  constructor(from: number) {
    this.left = from;
  }
  next(): { done: boolean; value: number } {
    if (this.left > 0) return { done: false, value: this.left-- };
    return { done: true, value: 0 };
  }
  [Symbol.iterator]() {
    return this;
  }
}
(globalThis as any).shelfOfCountdowns = new Countdown(1);
function once(): number {
  let sum = 0;
  for (const value of new Countdown(size * 8)) sum = (sum + value) | 0;
  return sum;
}
let told = 0;
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
