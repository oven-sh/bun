declare const console: { log(...values: unknown[]): void };
class Shape { constructor(public id: number) {} }
class Circle extends Shape { constructor(id: number, public radius: number) { super(id); } }
class Ring extends Circle { constructor(id: number, radius: number, public hole: number) { super(id, radius); } }
class Square extends Shape { constructor(id: number, public side: number) { super(id); } }
class Alone { constructor(public name: string) {} }
class Judged { constructor(public id: number) {} static [Symbol.hasInstance](value: unknown): boolean { return value === 42; } }
class HeirOfJudged extends Judged { }
class Changed { constructor(public id: number) {} }
class HeirOfChanged extends Changed { }
class Reparented { constructor(public id: number) {} }
class Counted { static made = 0; static make(): Counted { Counted.made++; return new Counted(); } }

function isCircle(s: Shape): boolean { return s instanceof Circle; }
function isRing(s: Shape): boolean { return s instanceof Ring; }
function isShape(s: Shape | Alone): boolean { return s instanceof Shape; }
function isCircleOrNothing(s: Shape | null | undefined): boolean { return s instanceof Circle; }
function isCircleOfAnything(s: unknown): boolean { return s instanceof Circle; }
function radiusOf(s: Shape): number { return s instanceof Circle ? s.radius : -1; }
function count(all: Shape[]): string { let circles = 0, rings = 0, squares = 0; for (const s of all) { if (s instanceof Ring) rings++; else if (s instanceof Circle) circles++; else if (s instanceof Square) squares++; } return circles + " " + rings + " " + squares; }
function isJudged(x: Judged | number): boolean { return x instanceof Judged; }
function isHeirOfJudged(x: Judged | number): boolean { return x instanceof HeirOfJudged; }
function isChanged(x: Changed): boolean { return x instanceof Changed; }
function isHeirOfChanged(x: Changed): boolean { return x instanceof HeirOfChanged; }
function isReparented(x: Reparented): boolean { return x instanceof Reparented; }
function isCounted(x: Counted | Alone): boolean { return x instanceof Counted; }

const all: Shape[] = [new Shape(1), new Circle(2, 5), new Ring(3, 6, 1), new Square(4, 7)];
for (let turn = 0; turn < 3; turn++) {
    console.log("circle", all.map(isCircle).join());
    console.log("ring", all.map(isRing).join());
    console.log("shape", all.map(isShape).join(), isShape(new Alone("a")));
    console.log("nothing", isCircleOrNothing(null), isCircleOrNothing(undefined), isCircleOrNothing(all[1]), isCircleOrNothing(all[3]));
    console.log("anything", [1, "x", null, undefined, {}, [], () => 1, Symbol.iterator, all[0], all[1], all[2], Object.create(Circle.prototype), Object.create(null), new Proxy(all[1], {})].map(isCircleOfAnything).join());
    console.log("radius", all.map(radiusOf).join());
    console.log("count", count(all));
    console.log("judged", isJudged(new Judged(1)), isJudged(42), isHeirOfJudged(new HeirOfJudged(1)), isHeirOfJudged(42));
    console.log("changed", isChanged(new Changed(1)), isChanged(new HeirOfChanged(1)), isHeirOfChanged(new Changed(1)), isHeirOfChanged(new HeirOfChanged(1)));
    console.log("reparented", isReparented(new Reparented(1)));
    console.log("counted", isCounted(Counted.make()), isCounted(new Alone("b")), Counted.made);
    if (turn === 0) {
        Object.defineProperty(Changed, Symbol.hasInstance, { value: (x: Changed) => x.id === 2, configurable: true });
        Object.setPrototypeOf(Reparented, { [Symbol.hasInstance]: () => false });
    }
    if (turn === 1) {
        delete (Changed as unknown as Record<symbol, unknown>)[Symbol.hasInstance];
        Object.setPrototypeOf(Reparented, Function.prototype);
    }
}
console.log("id 2", isChanged(new Changed(2)), isHeirOfChanged(new Changed(2)));
try { Object.defineProperty(Function.prototype, Symbol.hasInstance, { value: () => true }); console.log("defined"); } catch (e) { console.log(e instanceof TypeError); }
console.log("still", all.map(isCircle).join());
