// The setter lays a name that neither literal lists. One of the two may be carried out in an arm that does not run; the store meets both.
function make(raw) { return { raw, set value(next) { this.seen = next; } }; }
function touch(held, next) { held.value = next; return typeof held.seen; }
const kept = make(1), carried = make(2);
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), typeof kept.seen, typeof carried.seen, note.length);
