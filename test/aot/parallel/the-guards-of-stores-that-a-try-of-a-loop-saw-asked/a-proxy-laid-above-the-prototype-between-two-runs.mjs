class P { constructor(x) { this.x = x; } }
const log = [];
function run(n) { let s = 0; for (let i = 0; i < n; i++) s += Reflect.construct(P, [i]).x ?? 50; return s; }
const first = run(Number("4"));
Object.setPrototypeOf(P.prototype, new Proxy({}, { set(t, k, v, r) { log.push(String(k) + v); return true; } }));
console.log(first, run(Number("4")), log.join());
