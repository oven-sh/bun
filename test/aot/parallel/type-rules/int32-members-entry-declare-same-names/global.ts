declare global {
  interface Point { x: number; y: number }
}
const point: Point = { x: 0.5, y: 1.5 };
console.log(point.x + point.y);
export {};
