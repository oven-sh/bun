// The constructor lays a function of its own under the name on some objects: the read finds that one, not the method of the class.
class Counter {
  constructor(hides) {
    this.n = 1;
    if (hides) this.add = x => this.n - x;
  }
  add(x) {
    this.n = (this.n + x) | 0;
    return this.n;
  }
}
function once(i) {
  return new Counter((i & 3) === 3).add(i);
}
let sum = 0;
for (let i = 0; i < 40; i++) sum += once(i);
console.log(sum);
