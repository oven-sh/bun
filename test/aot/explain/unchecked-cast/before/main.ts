interface Point {
  x: number;
  y: number;
}

const made = Object.assign({ x: 3 }, { y: 4 }) as unknown as Point;
console.log(made.x + made.y);
