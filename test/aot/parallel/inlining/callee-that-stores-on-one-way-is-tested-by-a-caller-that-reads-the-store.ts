// a small function stores into an object on one of its two ways and returns a constant on each, and its caller branches on the answer and reads the object on both sides
type Cell = { seen: number };
function mark(cell: Cell, c: unknown) { if (c) { cell.seen = cell.seen + 1; return true; } return false; }
function subject(cell: Cell, c: unknown) { cell.seen = 10; if (mark(cell, c)) return "marked" + String(cell.seen); return "left" + String(cell.seen); }
function deed(c: unknown) { const cell: Cell = { seen: 0 }; return subject(cell, c) + "|" + String(cell.seen); }
console.log(deed(true), deed(false), deed(0), deed("x"), deed(null));
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += deed(i % 3).length;
console.log(String(lengths));
const frozen: Cell = Object.freeze({ seen: 5 });
try { console.log(subject(frozen, JSON.parse("1"))); } catch (e) { console.log((e as Error).name, String(frozen.seen)); }
