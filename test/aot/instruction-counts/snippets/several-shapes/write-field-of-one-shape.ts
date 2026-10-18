// writes a field of objects of one shape
type Point = { x: number; y: number; z: number; a?: number; b?: number; c?: number };
const operations = 96;
const tails = [''];
let text = "[";
for (let i = 0; i < operations; i++) text += (i ? "," : "") + `{"x":${i},"y":${i * 2},"z":${i * 3}${tails[i % tails.length]}}`;
const points = JSON.parse(text + "]") as Point[];
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) points[i].y = i;
  total += points[7].y;
}

console.log(total);
