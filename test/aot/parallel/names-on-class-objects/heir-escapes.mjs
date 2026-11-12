class Service { constructor(x) { this.x = x; } add(y) { return this.x + y; } }
const key = "hold" + (process.argv[9] ?? ""); globalThis[key] = value => { globalThis.kept = value; };
class Base { } class Heir extends Base { } Base.shared = new Service(7);
globalThis[key](Heir); globalThis["ke" + (process.argv[9] ?? "pt")].shared.x = "far";
console.log(Base.shared.add(1), Heir.shared.add(2));
