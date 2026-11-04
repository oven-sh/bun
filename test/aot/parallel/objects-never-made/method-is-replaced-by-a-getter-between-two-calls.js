// The class has a method under the name until somebody lays a getter there, through a value that nobody follows. From then on the read hands the new object to the getter.
const handedBack = new Function("f", "return f;");
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
  if (i === 20)
    Object.defineProperty(handedBack(Counter).prototype, "add", {
      get() {
        kept.push(this);
        this.n = 1000;
        return x => this.n + x;
      },
    });
  sum += once(i);
}
console.log(sum, kept.length, kept[0].n);
