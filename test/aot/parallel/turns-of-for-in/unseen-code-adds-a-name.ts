type Point = { x: number; y: number; z: number };
const change: (p: Point) => void = (0, eval)("(p) => { if (p.x & 1) { p.w = 9; } }");
function walks(p: Point): string { let s = ""; for (const name in p) { change(p); s += name + ":" + String(p[name as keyof Point]) + ";"; } return s; }
for (let i = 0; i < 6; i++) { const p: Point = { x: i, y: i + 1, z: i + 2 }; console.log(walks(p), Object.keys(p).join()); }
