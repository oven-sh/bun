import { area, type Shape, Kind } from "./shapes.ts";
const shapes: Shape[] = [
  { kind: Kind.Square, size: 2 },
  { kind: Kind.Circle, size: 1 },
];
console.log(shapes.map(shape => area(shape).toFixed(2)).join());
