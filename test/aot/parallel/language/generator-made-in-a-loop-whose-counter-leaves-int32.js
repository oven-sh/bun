// A loop makes a generator from its counter and walks it. Once the counter is no int32 the loop goes on in its generic copy, which makes and walks a generator of its own.
class Span {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }
  *values() {
    try {
      for (let k = this.from; k < this.to; k++) yield k;
    } finally {
      closed++;
    }
  }
  [Symbol.iterator]() {
    return this.values();
  }
}
let closed = 0;

function sumOf(i) {
  let sum = 0;
  for (const value of new Span(i & 3, 8)) sum += value;
  return sum;
}
function firstOver(i, limit) {
  for (const value of new Span(i & 3, 8)) if (value > limit) return value;
  return -1;
}
function throwsAt(i, limit) {
  try {
    for (const value of new Span(i & 3, 8)) if (value > limit) throw new RangeError(`${value}`);
  } catch (error) {
    return Number(error.message);
  }
  return -1;
}

function run(start, turns, step) {
  let sum = 0;
  for (let i = start, n = 0; n < turns; i += step, n++)
    sum = (sum + sumOf(i) + firstOver(i, n & 7) + throwsAt(i, n & 7)) | 0;
  return sum;
}

console.log(run(0, 1000, 1), closed);
console.log(run(2 ** 31 - 500, 1000, 1), closed);
console.log(run(2 ** 40, 100, 1), closed);
console.log(run(0.5, 100, 0.25), closed);
console.log(run(-(2 ** 31) + 50, 100, -1), closed);
console.log(run(NaN, 3, 1), closed);
