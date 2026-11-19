type Point = { x: number; y: number };
type Solid = { x: number; y: number; z: number };
type Depth = { x?: number };
type Named = { x: number; y: number; name: string };
type Line = { from: Point; to?: Point };
interface Box<Value> { value: Value }
function sum(point: Point, solid: Solid, depth: Depth, named: Named, line: Line, box: Box<number>): number {
  return point.x + point.y + solid.z + (depth.x ?? 0.25) + named.y + line.from.x + (line.to?.y ?? 0) + box.value;
}
export function fractions() {
  let step = 0.5;
  const counted: Depth = { get x() { return (step += 1); } };
  return [sum({ x: 0.5, y: 1.5 }, { x: 1, y: 2, z: 2.5 }, { x: 0.125 }, { x: 1, y: 1e12, name: "n" }, { from: { x: -0, y: NaN } }, { value: 0.0625 }), counted.x, counted.x].join(" ");
}
