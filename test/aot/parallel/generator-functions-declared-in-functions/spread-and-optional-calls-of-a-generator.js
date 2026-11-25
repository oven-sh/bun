// the calls that find_declaration_called_by_name() refuses for every function (spread, a chain). plain: true true 3
const n = +process.argv[2] || 3;
const above = made => Object.getPrototypeOf(made);
function f() {
  "use strict";
  function* gen(x) { yield x; }
  const list = [n];
  const a = () => gen(...list), b = () => gen?.(n), c = () => gen(n);
  return [above(a()) === above(b()), above(b()) === above(c()), a().next().value].join(" ");
}
console.log(f());
