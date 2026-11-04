// Two literals of different shapes, each with a setter of its own that stores a text where the literal lists a number. One may be carried out, the other stays; one store meets both.
const kept = { raw: 1, seen: 0, set value(next) { this.seen = "s" + next; } };
const carried = { low: 2, more: 3, seen: 0, set value(next) { this.seen = "t" + next; } };
function touch(held, next) { held.value = next; return typeof held.seen; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), kept.seen + 1, carried.seen + 1, note.length);
