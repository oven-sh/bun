// STATISTIC: AssignedMemberChecks >= 4
// What `f.call(this, x)` calls in a closure laid over a method is expected to be that method, though a fallback is written beside it.
const wrap = (f, factor) => function (n) { return f.call(this, n) * factor + this.k; };
class A { k = 2; m(n) { return n + this.k; } q(n) { return n - this.k; } }
A.prototype.m = wrap(A.prototype.m ?? (() => 1), 2);
A.prototype.q = wrap(A.prototype.q ?? (() => 1), 3);
const a = new A();
function sum() {
  let s = 0;
  for (let i = 0; i < 100; i++) {
    s += a.m(i & 3);
    s += a.q(i & 7);
  }
  return s;
}
console.log(sum());
a.k = 1.5;
console.log(sum());
a.k = "x";
console.log(String(sum()).length);
a.k = 2;
const written = A.prototype.m;
A.prototype.m = wrap(written, 5);
console.log(sum());
A.prototype.q = wrap(written, 2);
console.log(sum());
written.call = function () { return 9; };
console.log(sum());
export {};
