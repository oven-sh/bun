// One setter of a class stands above the instances of two classes and stores a text where both list a number. One instance may be carried out in an arm that does not run; one store meets both.
class Base { set value(next) { this.seen = "s" + next; } }
class Wide extends Base { raw = 0; more = 1; seen = 0; }
class Narrow extends Base { low = 0; seen = 0; }
const carried = new Wide(), kept = new Narrow();
function touch(held, next) { held.value = next; return typeof held.seen; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), kept.seen + 1, carried.seen + 1, note.length);
