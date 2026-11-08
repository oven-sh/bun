// More and fewer arguments are written than the callee has parameters; the callee counts its arguments, reads `arguments`, has defaults, or has no rest parameter.
class Taker {
  exact(a, b, ...rest) { return "e" + a + b + rest.join(); }
  one(a, ...rest) { return "o" + a + rest.join(); }
  three(a, b, c, ...rest) { return "t" + a + b + c + rest.join(); }
  counts(a, b, ...rest) { return "c" + arguments.length + rest.join(); }
  defaults(a, b = "d", ...rest) { return "d" + a + b + rest.join(); }
  none(a, b) { return "n" + a + b; }
  only(...rest) { return "r" + rest.join(); }
}
function all(taker, ...values) { return [taker.exact(1, 2, ...values), taker.one(1, 2, ...values), taker.three(1, 2, ...values), taker.counts(1, 2, ...values), taker.defaults(1, undefined, ...values), taker.none(1, 2, ...values), taker.only(...values)].join(" "); }
const taker = new Taker();
let last = "";
for (let i = 0; i < 300; i++) last = all(taker, i, "x") + " | " + all(taker);
console.log(last);
