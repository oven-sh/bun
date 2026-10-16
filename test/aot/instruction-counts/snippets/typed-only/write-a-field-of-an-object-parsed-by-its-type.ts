// writes a number field of objects that came out of parse<T>()
import { parse } from "bun";
interface Point { x: number; y: number }
const operations = 100;
const points = parse<Point[]>(JSON.stringify(Array.from({ length: operations }, (_, i) => ({ x: i, y: i * 0.5 + 0.25 }))));

kernel: {
  for (let i = 0; i < points.length; i++) {
    points[i].y = i + 0.5;
  }
}

console.log(points[7].y);
