// Two literals of different shapes, each with a setter of its own that lays a name which the literal does not list. One may be carried out; the store meets both.
const kept = { raw: 1, set value(next) { this.seen = next; } };
const carried = { low: 2, more: 3, set value(next) { this.seen = next; } };
function touch(held, next) { held.value = next; return typeof held.seen; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), typeof kept.seen, typeof carried.seen, note.length);
