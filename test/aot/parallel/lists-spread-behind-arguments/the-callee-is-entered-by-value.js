// One callee, entered directly behind the looks at the receiver, and by value: call, apply, Reflect.apply, a bound function, too few arguments.
// `direct` is read out of a table under a key that only the run knows, so its own body runs.
class Taker { count = 0; take(a, b, ...rest) { this.count++; return a + "," + b + ":" + rest.join() + ":" + rest.length; } }
function wrap(taker) { return function (...values) { return taker.take("a", "b", ...values); }; }
const taker = new Taker();
const table = { direct: wrap(taker), byValue: taker.take, bound: taker.take.bind(taker, "a") };
const names = Object.keys(table);
let last = "";
for (let i = 0; i < 300; i++) {
  const direct = table[names[0]], byValue = table[names[1]], bound = table[names[2]];
  last = [direct(i, 1), byValue.call(taker, "a", "b", i, 1), byValue.apply(taker, ["a", "b", i, 1]), Reflect.apply(byValue, taker, ["a", "b", i, 1]), bound("b", i, 1), byValue.call(taker, "a"), byValue.call(taker), direct(), direct.call(null, i), direct.apply(undefined, [i, , 2])].join(" ");
}
console.log(last, taker.count);
