type Point = { x: number; y: number };
type Alias = Point;
const point: Alias = { x: 0.5, y: 1.5 };
console.log(point.x + point.y);
export {};
