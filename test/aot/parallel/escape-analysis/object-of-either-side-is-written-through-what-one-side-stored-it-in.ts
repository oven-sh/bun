// an object that is one of two literals was stored into another object on one side. Behind the join it is written through what holds it and read under its own name
type Point = { x: number };
const kept: { point: Point | null } = { point: null };
function subject(c: unknown, v: number) { let p: Point; if (c) { p = { x: 1 }; kept.point = p; } else { p = { x: 2 }; kept.point = null; } if (kept.point) kept.point.x = v; return p.x; }
function deed(c: unknown, v: number) { return String(subject(c, v)); }
console.log(deed(true, 5), deed(false, 5));
let sum = 0;
for (let i = 0; i < 300; i++) sum += subject(i % 3, i);
console.log(String(sum));
console.log(deed(JSON.parse("1"), 7), deed(JSON.parse("0"), 7));
