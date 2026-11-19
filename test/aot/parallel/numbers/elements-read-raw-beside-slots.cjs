// STATISTIC: ElementsReadRawBesideSlots >= 1
// Link has seen numbers alone in the array, and the captured variable or the field read behind the element has a slot for numbers: the element is read as a double.
const makeHistogram = step => {
  const counts = new Array(8).fill(0);
  let total = 0.5;
  return {
    hit(x) {
      counts[x & 7] += step;
      total += x;
    },
    get(k) {
      return counts[k] + total;
    },
  };
};
class Filter {
  constructor(n, gain) {
    this.state = new Array(n).fill(0.5);
    this.gain = gain;
  }
  step(i) {
    this.state[i] += this.gain;
    return this.state[i] + this.gain;
  }
}
const a = makeHistogram(1.5), b = makeHistogram(0.25);
const f = new Filter(4, 0.75);
let sum = 0;
for (let i = 0; i < 100; i++) {
  a.hit(i);
  b.hit(i * 3);
  sum = sum * 0.5 + a.get(i & 7) - b.get(i & 3) + f.step(i & 3);
}
console.log(sum, a.get(0), a.get(7), b.get(5), f.step(0), f.step(3));
console.log(a.get(8), a.get(-1), b.get(100));
