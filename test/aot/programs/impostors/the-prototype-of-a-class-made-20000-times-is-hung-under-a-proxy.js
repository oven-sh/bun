function make() {
  class Leaf {
    answer() {
      return 1;
    }
  }
  Object.setPrototypeOf(Leaf.prototype, new Proxy({}, {}));
  return new Leaf().answer();
}
let sum = 0;
for (let i = 0; i < 20000; i++) sum += make();
console.log(sum);
