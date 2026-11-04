// Array.from, whose code is a function of the library, calls a callback that writes a field which the caller reads on both sides
class Box { x = 1; }
function deed(box: Box, from: number[]) { const before = box.x; const made = Array.from(from, v => { box.x = box.x + v; return v * 2; }); return before + " " + made.join() + " " + box.x; }
const box = new Box();
console.log(deed(box, []));
console.log(deed(box, [1, 2]));
let all = "";
for (let i = 0; i < 4; i++) all += deed(box, [i]) + ";";
console.log(all);
