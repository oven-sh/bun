function F(n) { this.n = n; }
F.prototype.m = function () { return 1; };
globalThis.F = F;
var old = new F(0);
function inner(older, count) { var total = 0; for (var i = 0; i < count; i++) { total += older.m(); var made = new F(i); total += made.m() * 10 + (Object.getPrototypeOf(made) === F.prototype ? 1000 : 0); } return total; }
var sum = 0;
for (var turn = 0; turn < 10; turn++) {
  if (turn === 5) (0, eval)("F.prototype = { m() { return 2; } }");
  sum += inner(old, 2);
}
console.log(sum);
