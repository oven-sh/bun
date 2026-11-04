type Point = { x: number; y: number; z: number };
const plainAbove = { w: 9 };
function names(p: Point): string { let s = ""; for (const name in p) s += name + ","; return s; }
let last = "", t = 0;
for (let i = 0; i < 30000; i++) {
  const p: Point = { x: i, y: 2, z: 3 };
  if (i % 3 === 0) Object.setPrototypeOf(p, plainAbove);
  last = names(p);
  t += last.length;
}
console.log(last, t);
