// Two literals of different shapes, each with a setter of its own that lays a name. One may be carried out, the other stays. Object.assign into one variable meets both.
const kept = { raw: 1, set value(next) { this.seen = next; } };
const carried = { low: 2, more: 3, set value(next) { this.seen = next + 100; } };
let note = "", said = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
for (let i = 0; i < 4; i++) { const held = i & 1 ? kept : carried; Object.assign(held, { value: i }); said += typeof held.seen + held.seen + " "; }
console.log(said, kept.seen, carried.seen, note.length);
