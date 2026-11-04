// Object.assign out of a variable that may hold either of two literals runs the getter of that one, which lays a name that no literal lists.
function make(raw) { return { raw, get value() { this.read = this.raw; return 7; } }; }
const kept = make(1), carried = make(2);
let note = "", said = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
for (let i = 0; i < 4; i++) { const held = i & 1 ? kept : carried; const copy = Object.assign({}, held); said += typeof held.read + copy.value + typeof copy.read + " "; }
console.log(said, typeof kept.read, typeof carried.read, note.length);
