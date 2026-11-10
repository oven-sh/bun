class P { constructor(x) { this.x = x; } }
function make(C, x) { return new C(x); }
globalThis.kept = make;
const log = [];
function hook(i) { if (i === 3) Object.defineProperty(P.prototype, "x", { set(v) { log.push(v); }, get() { return -1; }, configurable: true }); return i; }
function run(n) { let s = 0; for (let i = 0; i < n; i++) s = s * 10 + make(P, hook(i)).x; return s; }
console.log(run(Number("6")), log.join());
