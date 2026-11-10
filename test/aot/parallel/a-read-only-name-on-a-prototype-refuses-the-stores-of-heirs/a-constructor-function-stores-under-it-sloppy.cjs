function Gauge(level) { this.limit = level; this.level = level; }
Object.defineProperty(Gauge.prototype, "limit", { value: 10, enumerable: true });
function tell(gauge) { return gauge.limit + gauge.level; }
let said = 0, own = 0;
for (let turn = 0; turn < 3000; turn++) { const gauge = new Gauge(turn & 7); said = (said + tell(gauge)) % 1000003; if (Object.hasOwn(gauge, "limit")) own++; }
console.log(said, own, Object.keys(new Gauge(1)).join());
