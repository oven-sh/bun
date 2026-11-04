// an object that is one of two literals gets its keys in another order on each side, and one more behind the branch
type Point = { x?: number; y?: number; z?: number };
function subject(c: unknown) { const p: Point = {}; if (c) { p.x = 1; p.y = 2; } else { p.y = 2; p.x = 1; } p.z = 3; return p; }
function deed(c: unknown) { const p = subject(c); return Object.keys(p).join() + " " + JSON.stringify(p); }
console.log(deed(true));
console.log(deed(false));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i % 2);
console.log(text);
console.log(deed(JSON.parse("0")));
