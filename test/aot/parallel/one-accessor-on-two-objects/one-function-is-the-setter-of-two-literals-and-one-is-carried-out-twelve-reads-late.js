// As its neighbor, but the literal that may be carried out arrives there by twelve reads out of holders, and it is stored to first.
function put(next) { this.seen = next; }
const carried = { low: 0, more: 1 }, kept = { raw: 0 };
Object.defineProperty(carried, "value", { set: put });
Object.defineProperty(kept, "value", { set: put });
const h1 = { v: carried }, h2 = { v: h1 }, h3 = { v: h2 }, h4 = { v: h3 }, h5 = { v: h4 }, h6 = { v: h5 }, h7 = { v: h6 }, h8 = { v: h7 }, h9 = { v: h8 }, h10 = { v: h9 }, h11 = { v: h10 }, h12 = { v: h11 };
function touch(held, next) { held.value = next; return typeof held.seen; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = h12.v.v.v.v.v.v.v.v.v.v.v.v; note = error.toString(); }
console.log(touch(carried, 6), touch(kept, 5), typeof kept.seen, typeof carried.seen, note.length);
