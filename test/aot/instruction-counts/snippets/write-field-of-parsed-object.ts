// writes a field of an object that JSON.parse made
type Point = { x: number; y: number; z: number };
const operations = 100;
let text = "[";
for (let i = 0; i < operations; i++) text += (i ? "," : "") + `{"x":${i},"y":${i * 2},"z":${i * 3}}`;
const points = JSON.parse(text + "]") as Point[];
let total = 0;

kernel: {
  for (let i = 0; i < points.length; i++) points[i].y = i;
  total += points[7].y;
}

console.log(total);
