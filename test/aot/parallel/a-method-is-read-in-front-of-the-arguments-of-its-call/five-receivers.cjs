"use strict";
class A { constructor(n) { this.n = n; } f(x) { return this.n + x; } }
class B { constructor(n) { this.n = n; } f(x) { return this.n * 2 + x; } }
class C { constructor(n) { this.n = n; } f(x) { return this.n * 3 + x; } }
class D { constructor(n) { this.n = n; } f(x) { return this.n * 4 + x; } }
class H { constructor(n) { this.n = n; } }
const held = new H(5);
held.f = x => x + 1000;
const all = [new A(1), new B(2), new C(3), new D(4), held];
let count = 0;
function swap() { const mine = ++count; held.f = x => mine * 100 + x; return 1; }
function ask(turns) { let total = 0; for (let turn = 0; turn < turns; turn++) total += all[turn % 5].f(swap()); return total; }
const byValue = [ask];
console.log(byValue[0](Number(process.argv[2] ?? 5)));
