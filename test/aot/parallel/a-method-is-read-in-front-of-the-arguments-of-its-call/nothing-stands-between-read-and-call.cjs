// STATISTIC: MethodCallsThroughTable >= 1
// Nothing that anybody sees stands between the read and the call: the read may be left to the call, though one receiver holds the name as a field that was stored onto it from outside.
"use strict";
class A { constructor(n) { this.n = n; } f(x) { return this.n + x; } }
class B { constructor(n) { this.n = n; } f(x) { return this.n * 2 + x; } }
class H { constructor(n) { this.n = n; } }
const held = new H(5);
held.f = x => x + 1000;
const all = [new A(1), new B(2), held];
let count = 0;
function swap() { const mine = ++count; held.f = x => mine * 100 + x; return 1; }
function ask(turns) { let total = 0; for (let turn = 0; turn < turns; turn++) { total += all[turn % 3].f(1); swap(); } return total; }
const byValue = [ask];
console.log(byValue[0](Number(process.argv[2] ?? 3)));
