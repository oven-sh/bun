"use strict";
class A { constructor(n) { this.n = n; } f(x) { return this.n + x; } }
class B { constructor(n) { this.n = n; } f(x) { return this.n * 2 + x; } }
class H { constructor(n) { this.n = n; } }
const held = new H(5);
held.f = x => x + 1000;
const all = [new A(1), new B(2), held];
function swap(turn) { if (turn % 3 === 2) delete held.f; else held.f = x => x + turn; return 1; }
function ask(turns) { let total = 0; for (let turn = 0; turn < turns; turn++) { try { total += all[turn % 3].f(swap(turn)); } catch (e) { total += e instanceof TypeError ? 10000 : 1; } } return total; }
const byValue = [ask];
console.log(byValue[0](Number(process.argv[2] ?? 6)));
