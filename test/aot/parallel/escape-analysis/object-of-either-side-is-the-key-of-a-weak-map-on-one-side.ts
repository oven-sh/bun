// an object that is one of two literals was made the key of a WeakMap on one side, and is looked up behind the join
type Point = { x: number };
const seen = new WeakMap<Point, number>();
function subject(c: unknown) { let p: Point; if (c) { p = { x: 1 }; seen.set(p, 7); } else p = { x: 2 }; p.x = 3; return (seen.get(p) ?? 0) + p.x; }
function deed(c: unknown) { return String(subject(c)); }
console.log(deed(true), deed(false), deed(0), deed("x"));
let sum = 0;
for (let i = 0; i < 300; i++) sum += subject(i % 3);
console.log(String(sum));
console.log(deed(JSON.parse("1")), deed(JSON.parse("null")));
