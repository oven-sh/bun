interface Point {
  x: number;
  y: number;
}

function length(point: Point): number {
  return Math.hypot(point.x, point.y);
}

const corner: Point = { x: 3, y: 4 };
console.log(length(corner));
