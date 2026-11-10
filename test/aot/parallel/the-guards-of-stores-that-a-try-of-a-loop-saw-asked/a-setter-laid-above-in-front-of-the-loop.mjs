class P { constructor(x) { this.x = x; this.y = 1; } }
function make(C, x) { return new C(x); }
globalThis.kept = make;
const log = [];
function run(n) { let s = 0; for (let i = 0; i < n; i++) { const o = make(P, i); s += (o.x === undefined ? 100 : o.x) + o.y; } return s; }
const first = run(Number("5"));
Object.defineProperty(P.prototype, "x", { set(v) { log.push(v); }, get() { return undefined; }, configurable: true });
console.log(first, run(Number("5")), log.join());
