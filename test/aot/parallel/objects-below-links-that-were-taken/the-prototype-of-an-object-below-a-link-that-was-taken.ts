class Gauge { level = 1; read() { return this.level; } }
const lay: (made: unknown, Class: unknown) => void = (0, eval)("(made, Gauge) => { const link = Object.create(Gauge.prototype); link.tag = 'link'; Object.setPrototypeOf(made, link); }");
function above(value: Gauge): string { return (Object.getPrototypeOf(value) === Gauge.prototype) + " " + Gauge.prototype.isPrototypeOf(value) + " " + (Reflect.getPrototypeOf(value) === Gauge.prototype) + " " + ((value as any).__proto__ === Gauge.prototype) + " " + (value.constructor === Gauge) + " " + (value as any).tag; }
const made = new Gauge();
console.log(above(made));
lay(made, Gauge);
console.log(above(made), above(new Gauge()));
