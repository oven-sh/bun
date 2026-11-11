const unseen = (x) => [x][JSON.parse("0")];
function first() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return 1 + work; }
function second() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return 100 + work; }
function Gauge(n) { this.n = n; }
const laid = { value: first, enumerable: false, configurable: true };
if (unseen(false)) laid.writable = true;
Object.defineProperty(Gauge.prototype, "read", laid);
function run(count) { let total = 0; for (let i = 0; i < count; i++) total += new Gauge(i).read(); return total; }
function replace() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  try { Gauge.prototype.read = second; return "stored"; } catch (e) { return e.name; } }
console.log(run(300));
console.log(replace());
console.log(run(300));
console.log(Reflect.set(Gauge.prototype, "read", second), run(300));
