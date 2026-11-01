"use strict";
function show(label, make) { let text; try { text = String(make()); } catch (error) { text = error.constructor.name + ": " + error.message; } console.log(label + ": " + text); }
function V(x) { this.x = x; }
function W(y) { this.y = y; }
function sum(make, n) { let total = 0; for (let i = 0; i < n; i++) total += make(i); return total; }
class C { constructor(x) { this.x = x; } get() { return this.x; } }
Object.assign(C.prototype, { get() { return this.x + 1; }, more() { return this.x + 2; } });
show("class", () => sum(i => new C(i & 7).get() + new C(i & 3).more(), 2000));
