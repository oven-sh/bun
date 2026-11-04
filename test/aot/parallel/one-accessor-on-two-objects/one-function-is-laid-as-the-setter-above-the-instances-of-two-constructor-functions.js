// One function is laid by written descriptors on the prototype objects of two constructor functions and stores a text where the instances list a number. One instance may be carried out; one store meets both.
function put(next) { this.seen = "s" + next; }
function Wide() { this.raw = 0; this.more = 1; this.seen = 0; }
function Narrow() { this.low = 0; this.seen = 0; }
Object.defineProperty(Wide.prototype, "value", { set: put });
Object.defineProperty(Narrow.prototype, "value", { set: put });
const carried = new Wide(), kept = new Narrow();
function touch(held, next) { held.value = next; return typeof held.seen; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), kept.seen + 1, carried.seen + 1, note.length);
