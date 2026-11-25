class Gauge { level = 1; read() { return this.level; } }
function isGauge(value) { return value instanceof Gauge; }
const made = new Gauge();
console.log(isGauge(made));
Object.setPrototypeOf(made, null);
console.log(isGauge(made), isGauge(new Gauge()));
