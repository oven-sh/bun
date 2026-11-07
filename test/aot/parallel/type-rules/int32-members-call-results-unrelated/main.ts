// Reads an int32 member of a value that has no name: a call result, an element, a choice, a cast. Three other entry points, which nothing here imports, have objects with the same member names that hold fractions.
// Entry points: ./same-names.ts ./more-names.ts ./other-kinds-of-types-with-fractions.ts
import type { int32 } from "bun";
import "./other-kinds-of-types.ts";
import "./patterns-and-collections.ts";
interface Point { x: int32; y: int32 }
interface Line { from: Point; to?: Point }
interface Depth { x?: int32 }
interface Nullable { x: int32 | undefined; y: int32 | null }
interface Box<Value> { value: Value }
interface Whole { value: int32 }
class Kept { held: int32 = 1; }
class Factory {
  point(): Point { return make(7, 8); }
  static point(): Point { return make(9, 10); }
  get now(): Point { return make(11, 12); }
}
function make(x: int32, y: int32): Point { return { x, y }; }
function maybe(x: int32): Point | undefined { return x > 0 ? make(x, x) : undefined; }
function take(value: int32): int32 { return value; }
function tag(texts: TemplateStringsArray, x: int32): Point { return make(x, texts.length | 0); }
const makers = { make, line(): Line { return { from: make(13, 14) }; } };

function callResult(): int32 { return make(1, 2).x; }
function methodResult(factory: Factory): int32 { return factory.point().y; }
function staticResult(): int32 { return Factory.point().x; }
function constructed(): int32 { return new Factory().point().x; }
function getterResult(): int32 { return new Factory().now.y; }
function byKey(): int32 { return make(3, 4)["y"]; }
function element(list: Point[], at: int32): int32 { return list[at].x; }
function elementOfLiteral(): int32 { return [make(5, 6)][0].y; }
function chosen(first: boolean, a: Point, b: Point): int32 { return (first ? a : b).x; }
function fallback(a: Point | undefined, b: Point): int32 { return (a ?? b).y; }
function either(a: Point | null, b: Point): int32 { return (a || b).x; }
function assigned(a: Point): int32 { let kept: Point; return (kept = a).y; }
function sequence(a: Point): int32 { return (take(0), a).x; }
function chained(x: int32): int32 { return maybe(x)?.x ?? -1; }
function asserted(): int32 { return maybe(15)!.y; }
function cast(text: string): int32 { return (JSON.parse(text) as Point).x; }
function satisfied(): int32 { return (make(16, 17) satisfies Point).y; }
function deep(): int32 { return makers.line().from.y; }
function deepOptional(): int32 { return makers.line().to?.x ?? -2; }
async function awaited(point: Promise<Point>): Promise<int32> { return (await point).x; }
function* resumed(): Generator<undefined, int32, Point> { return (yield).y; }
function literal(n: int32): int32 { return ({ x: n, y: 2 } as Point).x; }
function fromMap(points: Map<string, Point>): int32 { return points.get("k")!.x; }
function tagged(): int32 { return tag`a${18}b`.y; }
function calledAtOnce(): int32 { return (() => make(19, 20))().x; }
function field(): int32 { const kept = new Kept(); kept.held = make(21, 22).x; return kept.held; }
function variable(): int32 { const value: int32 = make(23, 24).y; return value; }
function argument(): int32 { return take(make(25, 26).x); }
function defaulted(value: int32 = make(27, 28).y): int32 { return value; }
function pattern(): int32 { const { x } = make(29, 30); return x; }
function renamed(): int32 { const { y: other } = make(31, 32); return other; }
function inLoop(): int32 { let last: int32 = 0; for (const { x } of [make(33, 34)]) last = x; return last; }
function compound(): int32 { return (make(35, 36).x |= 64); }
function stored(target: Point): int32 { target.x = make(37, 38).y; return target.x; }
function inLiteral(): Point { return { x: make(39, 40).y, y: make(41, 42).x }; }
function optional(depth: () => Depth): int32 { return depth().x ?? -3; }
function nullable(made: () => Nullable): int32 { return made().x ?? made().y ?? -4; }
function open(box: () => Box<int32>): int32 { return box().value; }
function whole(box: () => Whole): int32 { return box().value; }
function largest(): int32 { return Math.max(make(43, 44).x, make(45, 46).y); }
function captured(): int32 { const read = (): int32 => make(47, 48).x; return read(); }

const generator = resumed();
generator.next();
console.log(
  callResult(), methodResult(new Factory()), staticResult(), constructed(), getterResult(), byKey(), element([make(49, 50)], 0), elementOfLiteral(),
  chosen(false, make(51, 52), make(53, 54)), fallback(undefined, make(55, 56)), either(null, make(57, 58)), assigned(make(59, 60)), sequence(make(61, 62)),
  chained(63), chained(0), asserted(), cast('{"x":64,"y":65}'), satisfied(), deep(), deepOptional(), await awaited(Promise.resolve(make(66, 67))), generator.next(make(68, 69)).value,
  literal(70), fromMap(new Map([["k", make(71, 72)]])), tagged(), calledAtOnce(), field(), variable(), argument(), defaulted(), pattern(), renamed(), inLoop(), compound(),
  stored(make(73, 74)), JSON.stringify(inLiteral()), optional(() => ({})), optional(() => ({ x: 75 })), nullable(() => ({ x: undefined, y: null })), nullable(() => ({ x: undefined, y: 76 })),
  open(() => ({ value: 77 })), whole(() => ({ value: 78 })), largest(), captured(),
);
