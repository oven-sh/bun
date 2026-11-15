class Gauge { level = 1; read() { return this.level; } }
const cut: (made: unknown, Class: unknown) => void = (0, eval)("(made, Gauge) => { const link = Object.create(Gauge.prototype); Object.setPrototypeOf(made, link); Object.setPrototypeOf(link, null); }");
function count(values: unknown[]): number { let found = 0; for (let i = 0; i < values.length; i++) if (values[i] instanceof Gauge) found++; return found; }
const all: unknown[] = [new Gauge(), new Gauge(), {}, new Gauge()];
console.log(count(all));
cut(all[1], Gauge);
console.log(count(all));
