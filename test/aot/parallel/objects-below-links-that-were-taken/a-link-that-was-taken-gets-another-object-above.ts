class Gauge { level = 1; read() { return this.level; } }
class Other { }
const move: (made: unknown, Class: unknown, Other: unknown) => void = (0, eval)("(made, Gauge, Other) => { const link = Object.create(Gauge.prototype); Object.setPrototypeOf(made, link); Object.setPrototypeOf(link, Other.prototype); }");
function tell(value: unknown): string { return (value instanceof Gauge) + " " + (value instanceof Other); }
const made = new Gauge();
console.log(tell(made));
move(made, Gauge, Other);
console.log(tell(made), tell(new Gauge()));
