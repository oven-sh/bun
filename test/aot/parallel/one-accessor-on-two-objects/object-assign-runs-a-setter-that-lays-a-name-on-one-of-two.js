// Object.assign into a variable that may hold either of two literals runs the setter of that one, which lays a name that no literal lists.
function make(raw) { return { raw, set value(next) { this.seen = next; } }; }
const kept = make(1), carried = make(2);
let note = "", said = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
for (let i = 0; i < 4; i++) { const held = i & 1 ? kept : carried; Object.assign(held, { value: i }); said += typeof held.seen + held.seen + " "; }
console.log(said, typeof kept.seen, typeof carried.seen, note.length);
