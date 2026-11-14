// STATISTIC: MethodsTestedAfterEndedGuards >= 2
// @ts-nocheck
const plus = k => (f, c) => function (n) { return f.call(this, n) + k; };
const twice = (f, c) => function (n) { return f.call(this, n) * 2; };
class A { k = 2; @plus(3) m(n) { return n + this.k; } @twice q(n) { return n - this.k; } }
const a = new A();
function run(times) { let s = 0; for (let i = 0; i < times; i++) s = (s + a.m(i & 3) + a.q(i & 7)) | 0; return s; }
console.log(run(400));
export {};
