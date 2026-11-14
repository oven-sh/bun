// A frozen table of functions and accessors at the top of a module
const table = Object.freeze({
  base: 10,
  get next() {
    return this.base + ++reads;
  },
  apply(call, ...rest) {
    return call.call(this, ...rest);
  },
});
let reads = 0;
function run(n) {
  const taken = { ...table };
  const result = table.apply(function (a, b) {
    return this.base * a + b;
  }, n, table.next);
  return [result, taken.next, typeof taken.next, reads, Object.keys(table).join("+")].join();
}
console.log(run(1));
console.log(run(20));
console.log(run(0));
