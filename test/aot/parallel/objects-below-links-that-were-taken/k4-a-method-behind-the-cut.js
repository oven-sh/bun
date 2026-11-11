class Gauge { level = 1; read() { return this.level; } }
function look(value) { return value instanceof Gauge ? value.read() : "no gauge"; }
const made = new Gauge();
const link = Object.create(Gauge.prototype);
Object.setPrototypeOf(made, link);
console.log(look(made));
Object.setPrototypeOf(link, null);
try { console.log(look(made)); } catch (error) { console.log(error.constructor.name); }
