"use strict";
class Amount { constructor(n) { this.n = n; this.valueOf = () => this.n * 100; this.toString = () => "own" + this.n; } valueOf() { return this.n; } toString() { return "above" + this.n; } }
function add(a, turns) { let s = 0; for (let i = 0; i < turns; i++) s += a + i; return s; }
const a = new Amount(3), turns = +(process.argv[2] ?? 50);
console.log(add(a, turns), +a, a * 2, a > 200, `${a}`, String(a), a + "", [a].join(), JSON.stringify({ a: a + 1 }));
