// parses an object of three declared and ten undeclared keys with JSON.parse<T>()
interface Point { x: number; y: number; label: string }
const operations = 10;
const text = JSON.stringify({ x: 1, y: 2, label: "l", a: 1, b: "two", c: true, d: null, e: 5, f: 6.5, g: "seven", h: 8, i: false, j: 10 });
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const point = JSON.parse<Point>(text);
    total += point.x + point.y;
  }
}

console.log(total);
