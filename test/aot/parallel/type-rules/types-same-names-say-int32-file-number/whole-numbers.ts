import type { int32 } from "bun";
interface Point { x: int32; y: int32 }
type Alias = { x: int32; y: int32 };
interface Solid extends Point { z: int32 }
interface Depth { x?: int32 }
interface Line { from: Point; to?: Point }
interface Fixed { readonly x: int32; readonly y: int32 }
interface Nullable { x: int32 | undefined; y: int32 | null }
interface Box<Value> { value: Value }
interface Whole { value: int32 }
class Holder { n: int32 = 0; constructor(point: Point) { this.n = point.x; } }
function take(value: int32): int32 { return value; }
function annotatedPattern(point: Point): int32 { const { x }: Point = point; return x; }
function renamed(point: Point): int32 { const { y: other } = point; return other; }
function parameterPattern({ x, y }: Point): int32 { return x > y ? x : y; }
function withDefault(depth: Depth): int32 { const { x = 4 } = depth; return x; }
function inLoop(list: Point[]): int32 { let last: int32 = 0; for (const { x } of list) last = x; return last; }
function loopMember(list: Point[]): int32 { let last: int32 = 0; for (const point of list) last = point.y; return last; }
function byKey(point: Point): int32 { return point["x"]; }
function chained(point: Point | undefined): int32 { return point?.x ?? -1; }
function asserted(point: Point | null): int32 { return point!.x; }
function cast(point: unknown): int32 { return (point as Point).x; }
function variable(point: Point): int32 { const value: int32 = point.x; return value; }
function argument(point: Point): int32 { return take(point.y); }
function defaulted(point: Point, value: int32 = point.x): int32 { return value; }
function either(first: boolean, point: Point, other: Point): int32 { return first ? point.x : other.y; }
function largest(point: Point): int32 { return Math.max(point.x, point.y); }
function captured(point: Point): int32 { const read = (): int32 => point.x; return read(); }
function alias(point: Alias): int32 { return point.x; }
function heir(solid: Solid): int32 { return solid.x > 0 ? solid.z : solid.y; }
function fixed(point: Fixed): int32 { return point.x; }
function mapped(point: Readonly<Point>): int32 { return point.x; }
function part(point: Partial<Point>): int32 { return point.x ?? 0; }
function picked(point: Pick<Point, "x">): int32 { return point.x; }
function both(point: Point & { name: string }): int32 { return point.y; }
function deep(line: Line): int32 { return line.to?.x ?? line.from.y; }
function nullable(point: Nullable): int32 { return point.x === undefined ? (point.y ?? -2) : point.x; }
function keyed<Key extends keyof Point>(point: Point, key: Key): Point[Key] { return point[key]; }
function open(box: Box<int32>): int32 { return box.value; }
function whole(box: Whole): int32 { return box.value; }
function inMap(points: Map<string, Point>): int32 { const point = points.get("k"); return point ? point.y : -1; }
function* made(point: Point): Generator<int32> { yield point.x; yield point.y; }
async function later(point: Point): Promise<int32> { return point.x; }
function stored(point: Point, target: Point): void { target.x = point.y; target.y = point.x; }
function literal(point: Point): Point { return { x: point.y, y: point.x }; }
function spread(point: Point): Point { return { ...point }; }
function compound(point: Point): int32 { point.x |= 1; point.y &= 6; return point.x; }
function next(point: Point): int32 { point.x = (point.x + 1) | 0; point.y = point.x; return point.y; }
function switched(point: Point): int32 { switch (point.x) { case 1: return point.y; default: return point.x; } }
export async function wholeNumbers() {
  const point: Point = { x: 1, y: 2 }, solid: Solid = { x: 3, y: 4, z: 5 }, target: Point = { x: 0, y: 0 };
  stored(point, target);
  return [
    new Holder(point).n, annotatedPattern(point), renamed(point), parameterPattern(point), withDefault({}), withDefault({ x: 9 }), inLoop([point, solid]), loopMember([point, solid]),
    byKey(point), chained(point), chained(undefined), asserted(point), cast(point), variable(point), argument(point), defaulted(point), either(true, point, solid), either(false, point, solid),
    largest(point), captured(point), alias({ x: 6, y: 7 }), heir(solid), fixed(point), mapped(point), part({}), part(point), picked(point), both({ x: 1, y: 8, name: "n" }),
    deep({ from: point }), deep({ from: point, to: solid }), nullable({ x: undefined, y: null }), nullable({ x: 5, y: 6 }), keyed(point, "y"), open({ value: 3 }), whole({ value: 4 }),
    inMap(new Map([["k", { x: 1, y: 2 }]])), [...made(point)].join(), await later(point), target.x, target.y, literal(point).x, spread(point).y, compound(target), next(target), switched(point),
  ].join(" ");
}
