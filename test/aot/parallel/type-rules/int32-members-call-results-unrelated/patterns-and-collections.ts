import type { int32 } from "bun";
interface Point { x: int32; y: int32 }
interface Solid { x: int32; y: int32; z: int32 }
interface Line { from: Point; to?: Point }
class Pixel implements Point { x: int32 = 1; y: int32 = 2; }
class Holder { point: Point = make(3, 4); static shared: Point = make(5, 6); }
class Base { point(): Point { return make(7, 8); } }
class Derived extends Base { viaSuper(): int32 { return super.point().x; } }
function make(x: int32, y: int32): Point { return { x, y }; }
function makeSolid(): Solid { return { x: 9, y: 10, z: 11 }; }
function line(): Line { return { from: make(12, 13), to: make(14, 15) }; }
function list(): Point[] { return [make(16, 17), make(18, 19)]; }

function nestedPattern(): int32 { const { from: { x } } = line(); return x; }
function arrayPattern(): int32 { const [{ y }] = list(); return y; }
function defaultedPattern(): int32 { const { to: { x } = make(22, 23) } = line(); return x; }
function parameterPattern({ from: { y } }: Line): int32 { return y; }
function holderUnnamed(): int32 { return new Holder().point.x; }
function holderStatic(): int32 { return Holder.shared.y; }
function optionalCall(maker?: () => Point): int32 { return maker?.().x ?? -1; }
function unionNamed(value: Point | Solid): int32 { return value.x; }
function unionUnnamed(first: boolean): int32 { return (first ? make(24, 25) : makeSolid()).y; }
function genericNamed<T extends Point>(value: T): int32 { return value.x; }
function genericUnnamed<T extends Point>(maker: () => T): int32 { return maker().y; }
function spreadUnnamed(): Point { return { ...make(26, 27) }; }
function spreadOver(): Point { return { ...make(28, 29), y: 30 }; }
function rest(): int32 { const { y, ...others } = make(31, 32); return others.x; }
function implementer(): int32 { const taken: Point = new Pixel(); return taken.x; }
function implementerUnnamed(maker: () => Point): int32 { return maker().y; }
function mapped(): int32[] { return list().map(({ x }) => x); }
function found(): int32 { return list().find(point => point.x > 16)!.y; }
function last(): int32 { return list().at(-1)!.x; }
function computedIndex(points: Point[]): int32 { return points[points.length - 1].y; }
function values(record: Record<string, Point>): int32 { return Object.values(record)[0].x; }
function recordUnnamed(record: Record<string, Point>, key: string): int32 { return record[key].y; }
function fromSet(points: Set<Point>): int32 { let sum: int32 = 0; for (const point of points) sum = point.x; return sum; }
function iterated(): int32 { let kept: int32 = 0; for (const point of list()) kept = point.y; return kept; }
function reduced(): int32 { return list().reduce((kept: int32, point): int32 => (point.x > kept ? point.x : kept), 0); }
function ternaryMembers(first: boolean): int32 { return first ? make(33, 34).x : makeSolid().z; }
function nullishMembers(): int32 { return line().to?.y ?? line().from.x; }
function inTemplate(): string { return `${make(35, 36).x}`; }
function compared(): boolean { return make(37, 38).x < makeSolid().z; }
function bitwise(): int32 { return make(39, 40).x & makeSolid().y; }
function negated(): int32 { return ~make(41, 42).x; }
function returnedByArrow(): int32 { return ((): int32 => line().from.y)(); }
function throughThis(this: { make(): Point }): int32 { return this.make().x; }
function classField(): int32 { class Local { kept: int32 = make(43, 44).y; } return new Local().kept; }
function parameterDefault(value: int32 = line().from.x): int32 { return value; }
function switchOn(): int32 { switch (make(45, 46).x) { case 45: return make(47, 48).y; default: return 0; } }

console.log(
  nestedPattern(), arrayPattern(), defaultedPattern(), parameterPattern(line()), holderUnnamed(), holderStatic(), optionalCall(), optionalCall(() => make(49, 50)),
  unionNamed(makeSolid()), unionUnnamed(false), genericNamed(makeSolid()), genericUnnamed(makeSolid), JSON.stringify(spreadUnnamed()), JSON.stringify(spreadOver()), rest(), implementer(), implementerUnnamed(() => new Pixel()),
  mapped().join(), found(), last(), computedIndex(list()), values({ a: make(51, 52) }), recordUnnamed({ a: make(53, 54) }, "a"), fromSet(new Set(list())), iterated(), reduced(), ternaryMembers(false), nullishMembers(),
  inTemplate(), compared(), bitwise(), negated(), returnedByArrow(), throughThis.call({ make: () => make(55, 56) }), classField(), parameterDefault(), switchOn(), new Derived().viaSuper(),
);
