// Flags: --aot-check=verify-each-pass
var neverTaken = process.argv.length > 99;
class NeverTakenKind { v = 1; neverTakenStep = 3; }
const k0T = [];
function k0(x, n) {
  if (neverTaken) x = new NeverTakenKind();
  let fuel = 3;
  if (x instanceof NeverTakenKind) neverTakenAddsTo_v(x);
  let a = 0, b = "s", c = x;
  const holder = { get v() { [b, a] = [a, b]; return 1; } };
  while (fuel !== fuel) fuel = [fuel];
  while (a === c && fuel-- > 0) { holder.v; while (c !== c) c = [c]; k0T.push(c === a); }
  return c === a;
}
console.log([k0(1, 0), k0("a", 0), k0({}, 2), k0T.join()].join(" "));
