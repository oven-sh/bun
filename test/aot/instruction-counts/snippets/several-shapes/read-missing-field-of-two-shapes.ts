// reads a field that objects of two shapes in turn do not have
type Point = { x: number; y: number; z: number; a?: number; b?: number; c?: number; d?: number };
const operations = 96;
const tails = ['', ',"a":1'];
let text = "[";
for (let i = 0; i < operations; i++) text += (i ? "," : "") + `{"x":${i},"y":${i * 2},"z":${i * 3}${tails[i % tails.length]}}`;
const points = JSON.parse(text + "]") as Point[];
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].d === undefined ? 1 : 2;
  total += sum;
}

console.log(total);
