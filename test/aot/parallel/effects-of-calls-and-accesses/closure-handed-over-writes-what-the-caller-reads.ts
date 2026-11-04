// a callee calls its parameter, and the one closure that this call hands it writes a field that the caller reads on both sides
class Box { x = 1; }
const box = new Box();
function each(f: () => void) { f(); f(); }
function grow() { box.x = box.x * 2; }
function deed() { const before = box.x; each(grow); return before + " " + box.x; }
console.log(deed());
let all = "";
for (let i = 0; i < 4; i++) all += deed() + ";";
console.log(all);
box.x = 3;
console.log(deed());
