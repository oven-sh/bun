// Reads an int32 member that every member of a union declares. Two other entry points, which nothing here imports, have objects with the same member names that hold fractions.
// Entry points: ./same-names.ts ./more-names.ts
import type { int32 } from "bun";
interface Point { x: int32; y: int32 }
interface Solid { x: int32; y: int32; z: int32 }
interface Named { x: int32; name: string }
interface Circle { kind: "circle"; x: int32; radius: int32 }
interface Square { kind: "square"; x: int32; side: int32 }
type Shape = Circle | Square;
class Pixel { x: int32 = 1; y: int32 = 2; }
function make(x: int32, y: int32): Point { return { x, y }; }
function makeSolid(): Solid { return { x: 9, y: 10, z: 11 }; }
function makeNamed(): Named { return { x: 12, name: "n" }; }
function makeShape(round: boolean): Shape { return round ? { kind: "circle", x: 13, radius: 14 } : { kind: "square", x: 15, side: 16 }; }

function unionNamed(value: Point | Solid): int32 { return value.x; }
function unionOfUnrelated(value: Point | Named): int32 { return value.x; }
function unionUnnamed(first: boolean): int32 { return (first ? make(24, 25) : makeNamed()).x; }
function unionWithClass(value: Point | Pixel): int32 { return value.y; }
function unionWithNull(value: Point | Named | null): int32 { return value?.x ?? -1; }
function unionByKey(value: Point | Named): int32 { return value["x"]; }
function unionPattern(value: Point | Named): int32 { const { x } = value; return x; }
function unionParameterPattern({ x }: Point | Named): int32 { return x; }
function shared(shape: Shape): int32 { return shape.x; }
function sharedUnnamed(round: boolean): int32 { return makeShape(round).x; }
function discriminated(shape: Shape): int32 { return shape.kind === "circle" ? shape.radius : shape.side; }
function discriminatedBySwitch(shape: Shape): int32 { switch (shape.kind) { case "circle": return shape.radius; case "square": return shape.side; } }
function narrowedByIn(value: Point | Named): int32 { return "y" in value ? value.y : value.x; }
function elementOfUnion(list: (Point | Named)[], at: int32): int32 { return list[at].x; }
function unionInLoop(list: Shape[]): int32 { let last: int32 = 0; for (const shape of list) last = shape.x; return last; }
function unionOfAliases(value: { x: int32 } | { x: int32; w: string }): int32 { return value.x; }
function nestedUnion(value: { at: Point | Named }): int32 { return value.at.x; }
function optionalInOne(value: Point | { x?: int32 }): int32 { return value.x ?? -2; }
function storedFromUnion(value: Point | Named, target: Point): int32 { target.y = value.x; return target.y; }

console.log(
  unionNamed(makeSolid()), unionOfUnrelated(makeNamed()), unionUnnamed(false), unionWithClass(new Pixel()), unionWithClass(make(1, 3)), unionWithNull(null), unionWithNull(make(4, 5)), unionByKey(makeNamed()),
  unionPattern(make(6, 7)), unionParameterPattern(makeNamed()), shared(makeShape(true)), sharedUnnamed(false), discriminated(makeShape(true)), discriminated(makeShape(false)), discriminatedBySwitch(makeShape(false)),
  narrowedByIn(make(17, 18)), narrowedByIn(makeNamed()), elementOfUnion([makeNamed()], 0), unionInLoop([makeShape(true), makeShape(false)]), unionOfAliases({ x: 19 }), nestedUnion({ at: make(20, 21) }),
  optionalInOne({}), optionalInOne(make(22, 23)), storedFromUnion(makeNamed(), make(0, 0)),
);
