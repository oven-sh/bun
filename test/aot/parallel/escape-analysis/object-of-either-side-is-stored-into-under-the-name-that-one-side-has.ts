// an object that is one of two literals is stored into under the name that one of the two still has
type Point = { x: number };
function subject(c: unknown, v: number) { const a: Point = { x: 1 }; const p: Point = c ? a : { x: 2 }; a.x = v; return p.x; }
function deed(c: unknown, v: number) { return String(subject(c, v)); }
console.log(deed(true, 5), deed(false, 5));
let sum = 0;
for (let i = 0; i < 300; i++) sum += subject(i % 3, i);
console.log(String(sum));
console.log(deed(JSON.parse("1"), 7), deed(JSON.parse("0"), 7));
