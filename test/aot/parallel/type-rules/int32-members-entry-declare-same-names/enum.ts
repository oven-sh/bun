enum Point { x = 0.5, y = 2 }
const point: { x: Point; y: Point } = { x: Point.x, y: Point.y };
console.log(point.x + point.y);
export {};
