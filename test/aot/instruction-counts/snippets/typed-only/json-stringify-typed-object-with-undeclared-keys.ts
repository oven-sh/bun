// writes an object that JSON.parse<T>() made of three declared and five undeclared keys
interface Point { x: number; y: number; label: string }
const operations = 10;
const point = JSON.parse<Point>(JSON.stringify({ x: 1, a: 1, y: 2, b: "two", label: "l", c: true, d: null, e: 5 }));
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) total += JSON.stringify(point).length;
}

console.log(total);
