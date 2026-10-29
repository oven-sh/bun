type Point = { x: number; y: number };
type Depth = { x?: number };
type Line = { from: Point; to?: Point };
interface Box<Value> { value: Value }
function sum(point: Point, depth: Depth, line: Line, box: Box<number>): number {
  return point.x + point.y + (depth.x ?? 0.25) + line.from.x + (line.to?.y ?? 0) + box.value;
}
console.log(sum({ x: 0.5, y: 1.5 }, { x: 0.125 }, { from: { x: -0, y: NaN } }, { value: 0.0625 }));
export {};
