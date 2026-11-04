// One function is the setter of two literals by written descriptors and stores a text where both list a number. One literal may be carried out in an arm that does not run, the other stays; one store meets both.
function put(next) { this.seen = "s" + next; }
const kept = { raw: 0, seen: 0 }, carried = { low: 0, more: 1, seen: 0 };
Object.defineProperty(kept, "value", { set: put });
Object.defineProperty(carried, "value", { set: put });
function touch(held, next) { held.value = next; return typeof held.seen; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), kept.seen + 1, carried.seen + 1, note.length);
