// reads a field of objects of one shape, in a function that is called through a value, outside loops
type Point = { x: number; y: number; z: number; a?: number; b?: number; c?: number };
const operations = 8;
const tails = [''];
let text = "[";
for (let i = 0; i < operations; i++) text += (i ? "," : "") + `{"x":${i},"y":${i * 2},"z":${i * 3}${tails[i % tails.length]}}`;
const points = JSON.parse(text + "]") as Point[];
function yOf(point: Point): number {
  return point.y;
}
function zOf(point: Point): number {
  return point.z;
}
const read = process.argv.length > 50 ? zOf : yOf;
let total = 0;

kernel: {
  total += read(points[0]) + read(points[1]) + read(points[2]) + read(points[3]);
  total += read(points[4]) + read(points[5]) + read(points[6]) + read(points[7]);
}

console.log(total);
