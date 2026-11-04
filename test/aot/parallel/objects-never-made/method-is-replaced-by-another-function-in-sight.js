// The method is stored over in plain sight, by a function that keeps its receiver.
const kept = [];
class Counter {
  constructor() {
    this.n = 1;
  }
  add(x) {
    this.n = (this.n + x) | 0;
    return this.n;
  }
}
function once(i) {
  return new Counter().add(i);
}
let sum = 0;
for (let i = 0; i < 40; i++) {
  if (i === 10)
    Counter.prototype.add = function (x) {
      kept.push(this);
      this.n = this.n + 2 * x;
      return this.n;
    };
  sum += once(i);
}
for (const counter of kept) counter.n++;
console.log(sum, kept.length, kept[3].n);
