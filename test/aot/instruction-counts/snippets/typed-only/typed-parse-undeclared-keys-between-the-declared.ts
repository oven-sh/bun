// parses an object whose undeclared keys stand before, between and behind the declared ones with JSON.parse<T>()
interface Point { x: number; y: number; label: string }
const operations = 10;
const text = JSON.stringify({ a: 1, x: 1, b: "two", c: [1, 2], y: 2, d: { e: 5 }, label: "l", f: null });
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const point = JSON.parse<Point>(text);
    total += point.x + point.y;
  }
}

console.log(total);
