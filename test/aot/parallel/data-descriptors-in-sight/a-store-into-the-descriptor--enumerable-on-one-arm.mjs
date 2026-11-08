const unseen = (x) => [x][JSON.parse("0")];
function first() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return 1 + work; }
function Gauge(n) { this.n = n; }
const laid = { value: first, writable: true, configurable: true };
if (unseen(false)) laid.enumerable = true;
Object.defineProperty(Gauge.prototype, "read", laid);
function names(g) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let out = ""; for (const k in g) out += k + ","; return out + work; }
let last = ""; for (let i = 0; i < 300; i++) last = names(new Gauge(i));
console.log(last, Object.keys(Gauge.prototype).join(), JSON.stringify(Object.assign({}, Gauge.prototype)));
