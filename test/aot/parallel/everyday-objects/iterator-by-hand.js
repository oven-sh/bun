// An object that is iterable by next and return, walked whole, in part and by spread
class Range {
  constructor(from, to) {
    this.from = from;
    this.to = to;
    this.closed = 0;
  }
  [Symbol.iterator]() {
    let at = this.from;
    return {
      next: () => (at < this.to ? { done: false, value: at++ } : { done: true, value: undefined }),
      return: () => (this.closed++, { done: true, value: undefined }),
    };
  }
}
function walk(from, to) {
  const range = new Range(from, to);
  let sum = 0;
  for (const n of range) if ((sum += n) > 10) break;
  const [first, second] = range;
  return [sum, first, second, [...range].length, Math.max(...range), range.closed].map(String).join();
}
console.log(walk(1, 4));
console.log(walk(5, 9));
console.log(walk(0, 2));
