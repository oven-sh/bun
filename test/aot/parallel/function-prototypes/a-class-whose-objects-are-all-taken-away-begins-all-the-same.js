// A function of the constructor makes the objects, and no object outlives its turn: the compiler takes every one of them away, on both sides of the test of the constructor's `prototype`.
// The class of a constructor function begins with its first object. Here nobody makes one, so the failing side of the test begins the class: the test fails once and not at every turn.
// COUNT: arrivals <= 20
function Box(a) {
  this.a = a;
}
Object.defineProperty(Box, "of", {
  value: function of(a) {
    return new Box(a);
  },
  writable: true,
  configurable: true,
});
function turn(i) {
  return Box.of(i & 7).a;
}
function bench(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += turn(i);
  return sum;
}
console.log(bench(+(process.argv[2] ?? 3000)));
