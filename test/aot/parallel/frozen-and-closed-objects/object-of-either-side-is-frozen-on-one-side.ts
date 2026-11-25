// an object that is one of two literals is frozen on one side of the branch and stored into behind it
type Point = { x: number; y?: number };
function subject(c: unknown, v: number) { let p: Point; if (c) { p = { x: 1 }; Object.freeze(p); } else p = { x: 2 }; p.y = v; p.x = v; return p.x + "," + p.y; }
function deed(c: unknown, v: number) { try { return subject(c, v); } catch (e) { return (e as Error).name; } }
console.log(deed(false, 3), deed(true, 3));
let thrown = 0;
for (let i = 0; i < 300; i++) thrown += deed(i % 3, i) === "TypeError" ? 1 : 0;
console.log(String(thrown));
console.log(deed(JSON.parse("0"), 4), deed(JSON.parse("1"), 4));
