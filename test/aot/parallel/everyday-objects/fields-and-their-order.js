// Fields of base and derived classes, initializers that read each other
let log = [];
const note = (name, value) => (log.push(name), value);
class Base {
  a = note("a", 1);
  b = note("b", this.a + 1);
  constructor(n) {
    note("base");
    this.n = n;
    this.init?.();
  }
}
class Derived extends Base {
  c = note("c", this.b + this.n);
  a = note("a2", this.c * 10);
  init() {
    note("init" + this.c);
  }
}
function run(n) {
  log = [];
  const one = new Derived(n);
  return Object.entries(one).map(([key, value]) => key + value).join() + " " + log.join(" ");
}
console.log(run(1));
console.log(run(30));
console.log(run(-5));
