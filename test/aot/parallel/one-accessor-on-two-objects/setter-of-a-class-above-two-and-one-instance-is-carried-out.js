// One setter of a class stands above the instances of two classes and lays a name that neither lists. One instance may be carried out in an arm that does not run; one store meets both.
class Base { set value(next) { this.seen = next; } get value() { this.read = 1; return 7; } }
class Wide extends Base { raw = 0; more = 1; }
class Narrow extends Base { low = 0; }
const carried = new Wide(), kept = new Narrow();
function touch(held, next) { held.value = next; return typeof held.seen; }
function look(held) { const got = held.value; return got + typeof held.read; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), look(kept), look(carried), note.length);
