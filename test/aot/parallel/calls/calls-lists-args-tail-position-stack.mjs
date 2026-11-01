// Calls with lists of arguments, in tail position and not, long and short, one on top of the other. A hundred thousand of them in tail position need no more stack than one.
// variant-stub-copies-2.test.ts always takes this program: there the code is laid out with several copies of the shared stubs, as in a very large program.
function sum(...values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
function countDown(n, ...rest) {
  if (n === 0) return sum(...rest);
  return countDown(n - 1, ...rest);
}
function bounce(n, list) {
  if (n === 0) return list.length;
  return bounce(...[n - 1, list]);
}
function grow(n, ...rest) {
  if (n === 0) return rest.length;
  return grow(n - 1, ...rest, n);
}
const long = Array.from({ length: 40 }, (_, i) => i);
console.log(sum(...long), sum(...[1, 2, 3]), sum(...[]), sum(...[1.5, 2.5]));
console.log(countDown(100000, ...long));
console.log(countDown(100000, 1, 2, 3));
console.log(bounce(100000, long));
console.log(grow(300));
console.log(Math.max(...long), Math.max.apply(null, long), Reflect.apply(sum, null, long));
class Holder {
  constructor(...parts) { this.parts = parts; }
  total(...more) { return sum(...this.parts, ...more); }
  again(n, ...more) { return n === 0 ? this.total(...more) : this.again(n - 1, ...more); }
}
console.log(new Holder(...long).total(...long), new Holder(1, 2).again(100000, ...long));
function thrower(n, ...rest) {
  if (n === 0) throw new RangeError("thrown below " + rest.length + " arguments");
  return thrower(n - 1, ...rest);
}
try {
  thrower(1000, ...long);
} catch (error) {
  console.log(error.message);
}
