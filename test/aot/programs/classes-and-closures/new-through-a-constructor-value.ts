interface Point { x: number; y: number }
interface PointMaker { new (x: number, y: number): Point }
interface Named { name: string }
interface NamedMaker { new (name: string): Named }

function PlainPoint(this: Point, x: number, y: number) { this.x = x; this.y = y; }
function ReturnsAnother(this: Point, x: number, y: number): Point { this.x = x; this.y = y; return { x: -x, y: -y }; }
function untypedPoint(this: any, x: number, y: number) { this.x = x; this.y = y; this.extra = "e"; }
class Base { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
class Derived extends Base { z = 7; constructor(x: number, y: number) { super(x * 2, y * 2); } }
class SeesNewTarget { x: number; y: number; constructor(x: number, y: number) { this.x = new.target === SeesNewTarget ? x : -1; this.y = y; } }
class Throws { x = 0; y = 0; constructor(x: number, y: number) { if (x > 2) throw new RangeError("too large: " + x); this.x = x; this.y = y; } }
const bound = (Base as any).bind(null, 40);
const proxied = new Proxy(Base, { construct(target, list) { return new target(list[0] + 100, list[1]); } });

const makers: unknown[] = [PlainPoint, ReturnsAnother, untypedPoint, Base, Derived, SeesNewTarget, Throws, bound, proxied];
function make(maker: PointMaker, x: number, y: number): Point { return new maker(x, y); }
for (let round = 0; round < 3; round++) {
  for (const maker of makers) {
    try {
      const made = make(maker as PointMaker, round + 1, 10);
      console.log(round, made.x, made.y, Object.keys(made).join(), Object.getPrototypeOf(made) === (maker as any).prototype, made instanceof (maker as any));
    } catch (error) {
      console.log(round, (error as Error).name, (error as Error).message);
    }
  }
}
for (const notAConstructor of [undefined, null, 1, "text", {}, () => 1, Math.max]) {
  try {
    make(notAConstructor as unknown as PointMaker, 1, 2);
    console.log("made");
  } catch (error) {
    console.log((error as Error).name);
  }
}
const namedMakers: unknown[] = [class { name: string; constructor(name: string) { this.name = name; } }, Error];
for (const maker of namedMakers) console.log(new (maker as NamedMaker)("n").name);
let order = "";
const sideEffects = new ((order += "callee ", Base) as PointMaker)((order += "first ", 1), (order += "second", 2));
console.log(order, sideEffects.x, sideEffects.y);
