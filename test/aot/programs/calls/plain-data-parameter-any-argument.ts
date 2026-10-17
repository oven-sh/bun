// An argument is held to the type that is written for its parameter, whatever kind of expression it is; a literal with an `any` in it for a parameter whose type is inferred is not.
interface Point { x: number; y: number; label?: string }
type Shape = { kind: "circle"; at: Point; r: number } | { kind: "box"; at: Point; w: number; h: number } | { kind: "dot"; at: Point };
function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle": return Math.round(shape.r * shape.r * 3);
    case "box": return shape.w * shape.h;
    default: return 0;
  }
}
function far(point: Point): number { return point.x + point.y + (point.label ? point.label.length : 0); }
function total(points: Point[]): number { let sum = 0; for (const point of points) sum += far(point); return sum; }
function same<T extends { at: Point }>(it: T, other: T): boolean { return it.at.x === other.at.x && it.at.y === other.at.y; }
const parsed: any = JSON.parse('{"x":3,"y":4,"label":"ab"}');
const held: Point = { x: 1, y: 2 };
function make(n: number): Point { return { x: n, y: n * 2 }; }
const shapes: Shape[] = [{ kind: "circle", at: held, r: 2 }, { kind: "box", at: make(1), w: 2, h: 3 }, { kind: "dot", at: { x: 0, y: 0 } }];
let sum = 0;
for (const shape of shapes) sum += area(shape);
sum += far(held) + far(make(5)) + far(parsed) + far({ x: 7, y: 8 }) + far(shapes[1].at) + far(held.x > 0 ? held : make(2)) + far(parsed as Point);
sum += total([held, make(2), parsed, { x: 1, y: 1, label: "abc" }]) + total(shapes.map(shape => shape.at));
console.log(sum, same({ at: held }, { at: parsed }), same({ at: make(3) }, { at: { x: 3, y: 6 } }), area({ kind: "box", at: parsed, w: 4, h: 5 }));
