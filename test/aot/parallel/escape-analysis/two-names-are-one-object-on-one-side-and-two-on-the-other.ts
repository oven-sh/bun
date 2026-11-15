// two names that are each one of two literals: on one side both are the same object, on the other they are two. Behind the join they are compared, and one is stored into
type Point = { x: number };
function subject(c: unknown) { let p: Point; let q: Point; if (c) { p = { x: 1 }; q = p; } else { p = { x: 2 }; q = { x: 2 }; } q.x = 9; return (p === q ? 10 : 0) + p.x; }
function deed(c: unknown) { return String(subject(c)); }
console.log(deed(true), deed(false), deed(0), deed("x"));
let sum = 0;
for (let i = 0; i < 300; i++) sum += subject(i % 3);
console.log(String(sum));
console.log(deed(JSON.parse("1")), deed(JSON.parse("null")));
