// Bound functions: compiled answers as plain.
function f(a, b, c) {
  return [this?.t, a, b, c, new.target === undefined].join();
}
const b1 = f.bind({ t: 1 }, "a"),
  b2 = b1.bind({ t: 2 }, "b");
console.log(b1("x", "y"), b2("z"), b2.call({ t: 3 }, "w"), b2.length, typeof new b2("n"), new b1() instanceof f);
