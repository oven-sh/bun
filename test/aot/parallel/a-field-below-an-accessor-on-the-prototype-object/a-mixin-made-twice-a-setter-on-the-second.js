function mix(Base) { function M(n) { Base.call(this, n); this.more = n; } M.prototype = Object.create(Base.prototype); return M; }
function P(n) { this.n = n; }
const log = [], a = mix(P), b = mix(P); Object.defineProperty(b.prototype, "more", { set(v) { log.push(v); }, configurable: true });
let s = ""; for (const C of [a, b, a]) { const o = new C(3); s += [o.n, o.more, Object.keys(o)].join() + ";"; }
console.log(s, log.join());
