// One function is laid by written descriptors on the prototype objects of two classes and stores a text where the instances list a number. One instance may be carried out; one store meets both.
function put(next) { this.seen = "s" + next; }
class Wide { raw = 0; more = 1; seen = 0; }
class Narrow { low = 0; seen = 0; }
Object.defineProperty(Wide.prototype, "value", { set: put });
Object.defineProperty(Narrow.prototype, "value", { set: put });
const carried = new Wide(), kept = new Narrow();
function touch(held, next) { held.value = next; return typeof held.seen; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), kept.seen + 1, carried.seen + 1, note.length);
