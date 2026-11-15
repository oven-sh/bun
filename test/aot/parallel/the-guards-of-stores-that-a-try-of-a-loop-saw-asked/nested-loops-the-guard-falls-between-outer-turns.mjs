class P { constructor(x) { this.x = x; } }
function make(C, x) { return new C(x); }
globalThis.kept = make;
const log = [];
function run(n) { let s = 0; for (let j = 0; j < n; j++) { for (let i = 0; i < 3; i++) s += make(P, i + j).x ?? 1000; if (j === 1) Object.defineProperty(P.prototype, "x", { set(v) { log.push(v); }, configurable: true }); } return s; }
console.log(run(Number("4")), log.join());
