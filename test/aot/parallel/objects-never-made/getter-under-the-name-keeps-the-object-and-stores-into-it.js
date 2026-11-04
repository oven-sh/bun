// Under the name that is called lies a getter, which is handed the new object: it keeps it and stores into it before the function that it answers with runs.
const kept = [];
class Counter {
  constructor() {
    this.n = 1;
  }
  get add() {
    kept.push(this);
    this.n = 100;
    return function (x) {
      this.n = (this.n + x) | 0;
      return this.n;
    };
  }
}
function once(i) {
  return new Counter().add(i);
}
let sum = 0;
for (let i = 0; i < 50; i++) sum += once(i);
console.log(sum, kept.length, kept[7].n);
