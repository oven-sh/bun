const unseen = (x) => [x][JSON.parse("0")];
function first() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return 1 + work; }
function Gauge(n) { this.n = n; }
const laid = { value: first, enumerable: false, configurable: true };
if (unseen(false)) laid.writable = true;
Object.defineProperty(Gauge.prototype, "read", laid);
function run(count) { let total = 0; for (let i = 0; i < count; i++) total += new Gauge(i).read(); return total; }
function overwrite(g) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  try { g.read = 5; return "stored " + typeof g.read; } catch (e) { return e.name + " " + typeof g.read; } }
function Below(n) { this.n = n; this.read = n; }
Below.prototype = Object.create(Gauge.prototype);
function make(i) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0;
  try { return typeof new Below(i).read; } catch (e) { return e.name; } }
console.log(run(300));
console.log(overwrite(new Gauge(1)));
let last = ""; for (let i = 0; i < 300; i++) last = make(i); console.log(last);
console.log(Object.getOwnPropertyDescriptor(Gauge.prototype, "read").writable);
