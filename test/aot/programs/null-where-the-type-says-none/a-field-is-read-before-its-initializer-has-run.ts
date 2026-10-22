interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
class Base { seen: string; constructor() { this.seen = this.look(); } look(): string { return "base"; } }
class Derived extends Base { point: Point = origin; name: string = "n"; look(): string { return [this.point === undefined, typeof this.point, this.name === undefined, this.point?.x ?? "no x"].join(); } }
class Throwing extends Base { point: Point = origin; look(): string { return String(this.point.x); } }
console.log(new Derived().seen, new Derived().look());
attempt("throwing", () => new Throwing().seen);
