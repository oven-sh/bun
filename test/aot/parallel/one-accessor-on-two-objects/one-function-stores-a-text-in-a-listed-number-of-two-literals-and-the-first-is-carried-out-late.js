// As its neighbor, in the other order: the literal that may be carried out is made, defined on and stored to first, and arrives in the arm by twelve reads out of holders.
function put(next) { this.seen = "s" + next; }
const carried = { low: 0, more: 1, seen: 0 }, kept = { raw: 0, seen: 0 };
Object.defineProperty(carried, "value", { set: put });
Object.defineProperty(kept, "value", { set: put });
const h1 = { v: carried }, h2 = { w: h1 }, h3 = { v: h2 }, h4 = { w: h3 }, h5 = { v: h4 }, h6 = { w: h5 }, h7 = { v: h6 }, h8 = { w: h7 }, h9 = { v: h8 }, h10 = { w: h9 }, h11 = { v: h10 }, h12 = { w: h11 };
function touch(held, next) { held.value = next; return typeof held.seen; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = h12.w.v.w.v.w.v.w.v.w.v.w.v; note = error.toString(); }
console.log(touch(carried, 6), touch(kept, 5), kept.seen + 1, carried.seen + 1, note.length);
