// a call by value enters one of two functions, one of which writes a field that the caller reads on both sides
class Box { x = 1; y = 1; }
function left(b: Box) { b.x = b.x + 1; return "left"; }
function right(b: Box) { b.y = b.y + 1; return "right"; }
function deed(b: Box, flag: boolean) { const x = b.x; const y = b.y; const f = flag ? left : right; const name = f(b); return name + " " + x + y + " " + b.x + b.y; }
const box = new Box();
console.log(deed(box, true));
console.log(deed(box, false));
let all = "";
for (let i = 0; i < 4; i++) all += deed(box, i % 2 === 0) + ";";
console.log(all);
