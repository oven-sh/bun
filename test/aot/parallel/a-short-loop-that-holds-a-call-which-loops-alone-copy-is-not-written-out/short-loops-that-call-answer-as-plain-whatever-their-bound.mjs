// The callee is of a size that loops alone copy. Bounds of 0, 1, 2, 3 and 8; a break; a continue; a closure that captures the counter; a call that throws in the second turn; a counter written in the turn.
function weigh(box, i) { const held = box.list; const at = held[i]; return typeof at === "number" ? at * 2 + box.add : String(at).length + box.add; }
const box = JSON.parse('{"list":[1,"two",3.5,null,5,"six",7,8.25],"add":10}');
const none = () => { let s = 0; for (let i = 0; i < 0; i++) s += weigh(box, i); return s; };
const one = () => { let s = 0; for (let i = 0; i < 1; i++) s += weigh(box, i); return s; };
const two = () => { let s = 0; for (let i = 0; i < 2; i++) s += weigh(box, i); return s; };
const three = () => { let s = 0; for (let i = 0; i < 3; i++) s += weigh(box, i); return s; };
const eight = () => { let s = 0; for (let i = 0; i < 8; i++) s += weigh(box, i); return s; };
const broken = () => { let s = 0; for (let i = 0; i < 3; i++) { if (weigh(box, i) > 12) break; s += i + 1; } return s; };
const skipped = () => { let s = 0; for (let i = 0; i < 3; i++) { if (i === 1) continue; s += weigh(box, i); } return s; };
const captured = () => { const kept = []; for (let i = 0; i < 3; i++) kept.push(() => weigh(box, i) + i); return kept.map(f => f()).join(); };
const stepped = () => { let s = 0; for (let i = 0; i < 3; i++) { s += weigh(box, i); if (s > 20) i++; } return s; };
function picky(box, i) { const held = box.list; if (i === 1) throw new RangeError("the second turn " + held.length); const at = held[i]; return typeof at === "number" ? at + box.add : box.add; }
const thrown = () => { let s = 0; try { for (let i = 0; i < 3; i++) s += picky(box, i); } catch (e) { return s + ":" + e.message; } return s; };
const said = [];
for (let round = 0; round < 3; round++) said.push([none(), one(), two(), three(), eight(), broken(), skipped(), captured(), stepped(), thrown()].join(" "));
console.log(new Set(said).size, said[0]);
