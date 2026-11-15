class Range {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }
  *[Symbol.iterator]() {
    for (let at = this.from; at < this.to; at++) yield at;
  }
}
let sum = 0;
for (const at of new Range(2, 6)) sum += at;
console.log(sum, [...new Range(0, 3)].join());
