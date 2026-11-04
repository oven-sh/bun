// The constructor of a class stores into `this`, which may be an object of a class below with fields of its own, laid in front of or behind those of the base.
class Shape { id: number; name: string; tag: unknown; constructor(id: number, name: string) { this.id = id; this.name = name; this.tag = undefined; } }
class Circle extends Shape { radius = 1; constructor(id: number) { super(id, "circle"); this.radius = id * 2; } }
class Square extends Shape { side: number; corner: unknown; constructor(id: number) { super(id, "square"); this.side = id; this.corner = null; } }
class Odd extends Shape { declare extra: number; constructor(id: number) { super(id, "odd"); if (id & 1) this.extra = id; } }
function Made(this: any, kind: number, pos: number) { this.pos = pos; this.kind = kind; this.flags = 0; }
function show(value: object) { return Object.keys(value).join() + " " + JSON.stringify(value); }
function tell(f: () => unknown) { try { console.log(f()); } catch (e) { console.log((e as Error).name); } }
for (let round = 0; round < 3; round++) {
    tell(() => show(new Shape(round, "plain")));
    tell(() => show(new Circle(round)));
    tell(() => show(new Square(round)));
    tell(() => show(new Odd(round)));
    tell(() => show(Reflect.construct(Shape, [round, "as a circle"], Circle)));
    tell(() => show(Reflect.construct(Shape, [round, "as an object"], Object)));
    tell(() => show(new (Made as any)(1, round)));
    tell(() => { const twice = new (Made as any)(1, round); Made.call(twice, 2, 3); return show(twice); });
    tell(() => { const other = { flags: 9, kind: 8 }; Made.call(other, 2, 3); return show(other); });
    tell(() => { const below = Object.create(new (Made as any)(1, 2)); Made.call(below, 4, 5); return show(below); });
    tell(() => { "use strict"; const frozen = Object.freeze(Object.create(Made.prototype)); Made.call(frozen, 1, 2); return show(frozen); });
    tell(() => { const early = Object.create(Made.prototype); early.kind = "early"; Made.call(early, 1, 2); return show(early); });
}
class Late extends Shape { late = "late"; }
tell(() => show(new Late(1, "late")));
let seen = "";
Object.defineProperty(Shape.prototype, "name", { set(value) { seen += value; }, configurable: true });
tell(() => show(new Circle(7)) + " " + seen);
tell(() => show(new Shape(8, "x")) + " " + seen);
