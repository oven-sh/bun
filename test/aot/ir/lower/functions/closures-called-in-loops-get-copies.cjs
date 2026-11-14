// A factory of closures is copied for each call that runs once where a loop calls the closure and the closure uses what the call passes: h, k and the argument of k, and the only call of a factory
// that passes a literal: three. The others get none: one call alone that passes none, a closure that no loop calls, and a closure that uses nothing of its factory.
// RUN: lower
// CHECK: = IsClosureOf
// CHECK: = IsClosureOf
// CHECK: = IsClosureOf
// CHECK: = IsClosureOf
// CHECK-NOT: = IsClosureOf

const tools = {
  compose(f, g) { return x => f(g(x)); },
  alone(a) { return x => x + a; },
  below(a) { return x => x < a; },
  quiet(a) { return x => x - a; },
  same(a) { return function (x) { return x; }; },
};
const h = tools.compose(x => x + 1, x => x * 2), k = tools.compose(tools.compose(x => x - 1, x => x ^ 3), Math.abs);
let seed = 1;
const one = tools.alone(seed), three = tools.below(3), low = tools.quiet(1), high = tools.quiet(2), first = tools.same(1), second = tools.same(2);
let sum = low(1) + high(2);
for (let i = 0; i < 9; i++) sum += h(i) + k(i) + one(i) + three(i) + first(i) + second(i);
console.log(sum);
