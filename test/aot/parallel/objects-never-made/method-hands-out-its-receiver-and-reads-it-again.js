// The method itself hands the object to code that nobody has seen, which stores into it, and reads the field again.
const touch = new Function("o", "o.n = o.n * 10; return o;");
class Counter {
  constructor() {
    this.n = 1;
  }
  add(x) {
    this.n = (this.n + x) | 0;
    touch(this);
    return this.n;
  }
}
function once(i) {
  return new Counter().add(i);
}
let sum = 0;
for (let i = 0; i < 30; i++) sum += once(i);
console.log(sum);
