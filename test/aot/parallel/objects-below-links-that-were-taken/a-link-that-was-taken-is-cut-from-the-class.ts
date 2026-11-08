class Gauge { level = 1; read() { return this.level; } }
const cut: (made: unknown, Class: unknown) => void = (0, eval)("(made, Gauge) => { const link = Object.create(Gauge.prototype); Object.setPrototypeOf(made, link); Object.setPrototypeOf(link, null); }");
function isGauge(value: unknown): boolean { return value instanceof Gauge; }
const made = new Gauge();
console.log(isGauge(made), isGauge({}));
cut(made, Gauge);
console.log(isGauge(made), isGauge(new Gauge()));
