// iterates with for of over an object whose Symbol.iterator returns an instance of a class with next()
class RangeIterator {
  at: number;
  readonly end: number;
  constructor(at: number, end: number) {
    this.at = at;
    this.end = end;
  }
  next(): IteratorResult<number, undefined> {
    if (this.at < this.end) return { value: this.at++, done: false };
    return { value: undefined, done: true };
  }
}
class Range {
  readonly from: number;
  readonly to: number;
  constructor(from: number, to: number) {
    this.from = from;
    this.to = to;
  }
  [Symbol.iterator](): RangeIterator {
    return new RangeIterator(this.from, this.to);
  }
}
const operations = 100;
const kept: Iterable<number>[] = [];
let total = 0;

kernel: {
  kept[0] = new Range(0, operations);
  for (const n of kept[0]) total += n;
}

console.log(total);
