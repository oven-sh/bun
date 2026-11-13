const log = [];
class P { constructor(x) { this.x = x; } }
class H extends P { set x(v) { log.push("set" + v); } get x() { return 7; } }
function make(C, x) { return new C(x); }
globalThis.kept = make;
function run(n) { let s = 0; for (let i = 0; i < n; i++) s = s * 10 + make(i & 1 ? H : P, i).x; return s; }
console.log(run(Number("6")), log.join());
