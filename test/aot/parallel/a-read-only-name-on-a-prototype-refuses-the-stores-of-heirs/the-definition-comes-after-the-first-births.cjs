function Gauge(level) { this.limit = level; this.level = level; }
function tell(gauge) { return gauge.limit + gauge.level; }
let said = 0, own = 0;
for (let turn = 0; turn < 3000; turn++) {
  if (turn === 1500) Object.defineProperty(Gauge.prototype, "limit", { value: 10 });
  const gauge = new Gauge(turn & 7); said = (said + tell(gauge)) % 1000003; if (Object.hasOwn(gauge, "limit")) own++;
}
console.log(said, own);
