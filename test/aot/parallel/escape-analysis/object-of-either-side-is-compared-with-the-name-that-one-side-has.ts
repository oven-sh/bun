// an object that is one of two literals is compared with the name that one of the two still has
type Point = { x: number };
function subject(c: unknown) { const a: Point = { x: 1 }; const p: Point = c ? a : { x: 2 }; return p === a; }
function deed(c: unknown) { return String(subject(c)); }
console.log(deed(true), deed(false), deed(0), deed("x"));
let same = 0;
for (let i = 0; i < 300; i++) same += subject(i % 3) ? 1 : 0;
console.log(String(same));
console.log(deed(JSON.parse("1")), deed(JSON.parse("null")));
