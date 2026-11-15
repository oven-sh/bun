// Functions that make functions: curried, composed, with the rest of the arguments
const curry = (call, ...first) => (first.length >= call.length ? call(...first) : (...more) => curry(call, ...first, ...more));
const compose = (...calls) => value => calls.reduceRight((all, call) => call(all), value);
function run(n) {
  const add = curry((a, b, c) => a + b * 10 + c * 100);
  const twice = compose(x => x - 1, x => x * 2, add(n)(1));
  return [add(1)(2)(3), add(1, 2)(3), add(n, n, n), twice(2), compose()(n), [1, 2].map(add(0, n)).join("+")].join();
}
console.log(run(1));
console.log(run(7));
console.log(run(0));
