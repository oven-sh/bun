// reads a field of an object that JSON.parse made
type Point = { x: number; y: number; z: number };
const operations = 100;
let text = "[";
for (let i = 0; i < operations; i++) text += (i ? "," : "") + `{"x":${i},"y":${i * 2},"z":${i * 3}}`;
const points = JSON.parse(text + "]") as Point[];
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].y;
  total += sum;
}

console.log(total);
