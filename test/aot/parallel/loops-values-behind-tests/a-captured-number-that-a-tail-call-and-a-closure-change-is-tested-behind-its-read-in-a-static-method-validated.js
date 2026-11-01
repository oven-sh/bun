// Flags: --aot-validate
// A function that calls itself last and a closure both change a number of the function around them, in a loop whose counter a third closure steps. The number is carried around the loop, and is tested for its type where the program reads it, with the loop in a static method.
const show = (v) => (typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v));
class Worker { static run(x, y, z) {
  let a = x, b = y, c = z, d = 0, e = 2147483647, f = 9007199254740991;
  function down(n, sum = 0, last = 0) { if (n <= 0) return sum + last + b; d = d & n; return down(n - 1, (sum + d) | 0, n); }
  const bump = () => { d += 3; };
  for (let i = 0; i < 7; i++) {
    { const t = c; c = b; b = t; }
    { const before = e; const got = down((c & 7)); e = before + got; }
    bump();
    { const skip = () => { i++; }; if ((c & 3) === 0) skip(); }
  }
  return [a / 2, b / 2, c / 2, d / 2, e / 2, f / 2].map(show).join();
} }
console.log([Worker.run(2, 65536, 2147483646), Worker.run(9, 2, 9), Worker.run(8, 65535, -2147483647), Worker.run(-7, 1, 0.5), Worker.run(5, 2147483646, -2147483647), Worker.run(4, -65536, 0), Worker.run(2147483646, 2, 12), Worker.run(-32768, 256, -0.5)].join(" | "));
