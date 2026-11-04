class A { constructor(x) { if (x % 3 === 0) return { other: x }; this.x = x; } }
class B extends A { k() { return 1; } }
globalThis.kept = [A, B];
function run(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new B(i); t += o instanceof B ? o.k() + o.x : o.other * 2 + (o.k === undefined ? 7 : 0); } return t; }
console.log(run(30000));
class P { constructor(x) { return x; } }
class Q extends P { }
globalThis.more = [P, Q];
function primitives() { const seen = []; for (const x of [1, "s", null, undefined, true, 5n]) { try { seen.push(new Q(x) instanceof Q); } catch (e) { seen.push(e.constructor.name); } } return seen.join(); }
console.log(primitives(), primitives());
