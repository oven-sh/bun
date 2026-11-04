// One literal with a setter is stored under `prototype` of two constructor functions, so the setter runs with their instances as `this` and stores a text where they list a number. One instance may be carried out.
const above = { set value(next) { this.seen = "s" + next; }, get value() { this.read = "r"; return 7; } };
function Wide() { this.raw = 0; this.more = 1; this.seen = 0; this.read = 0; }
function Narrow() { this.low = 0; this.seen = 0; this.read = 0; }
Wide.prototype = above;
Narrow.prototype = above;
const carried = new Wide(), kept = new Narrow();
function touch(held, next) { held.value = next; return typeof held.seen; }
function look(held) { const got = held.value; return got + typeof held.read; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), look(kept), look(carried), kept.seen + 1, carried.seen + 1, typeof above.seen, note.length);
