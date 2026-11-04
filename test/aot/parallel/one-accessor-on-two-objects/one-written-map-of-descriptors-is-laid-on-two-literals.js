// Object.defineProperties with one written map, on two literals. One literal may be carried out.
const map = { value: { set(next) { this.seen = next; }, get() { this.read = 1; return 7; } } };
const kept = { raw: 0 }, carried = { low: 0, more: 1 };
Object.defineProperties(kept, map);
Object.defineProperties(carried, map);
function touch(held, next) { held.value = next; return typeof held.seen; }
function look(held) { const got = held.value; return got + typeof held.read; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(touch(kept, 5), touch(carried, 6), look(kept), look(carried), note.length);
