class Gauge { level = 1; read() { return this.level; } }
function isGauge(value: unknown): boolean { return value instanceof Gauge; }
const made = new Gauge();
console.log(isGauge(made), isGauge({}));
const link = Object.create(Gauge.prototype);
Object.setPrototypeOf(made, link);
console.log(isGauge(made));
Object.setPrototypeOf(link, null);
console.log(isGauge(made), isGauge(new Gauge()));
