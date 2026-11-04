// One function is laid as the setter on two literals of different shapes by written descriptors. One literal may be carried out in an arm that does not run, the other stays; one store meets both.
function put(next) { this.seen = next; }
const kept = { raw: 0 }, carried = { low: 0, more: 1 };
Object.defineProperty(kept, "value", { set: put });
Object.defineProperty(carried, "value", { set: put });
function touch(held, next) { held.value = next; return typeof held.seen; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), typeof kept.seen, typeof carried.seen, note.length);
