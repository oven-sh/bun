class Gauge { level = 1; read() { return this.level; } }
function isGauge(value) { return value instanceof Gauge; }
const made = new Gauge();
const link = Object.create(Gauge.prototype);
Reflect.setPrototypeOf(made, link);
console.log(isGauge(made));
Reflect.setPrototypeOf(link, Object.prototype);
console.log(isGauge(made), Gauge.prototype.isPrototypeOf(made), typeof made.read);
