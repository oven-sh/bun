"use strict";
class A { constructor(n) { this.n = n; } f(x) { return this.n + x; } }
class B { constructor(n) { this.n = n; } f(x) { return this.n * 2 + x; } }
class H { constructor(n) { this.n = n; } }
const held = new H(5);
held.f = x => x + 1000;
const all = [new A(1), new B(2), held];
let count = 0;
function swap() { const mine = ++count; held.f = x => mine * 100 + x; return 1; }
function ask(x) { const r = x.f(swap()); return r + 1; }
const byValue = [ask];
for (let i = 0; i < Number(process.argv[2] ?? 3); i++) console.log(byValue[0](all[i % 3]));
