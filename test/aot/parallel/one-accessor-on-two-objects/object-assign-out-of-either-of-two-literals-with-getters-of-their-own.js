// Two literals of different shapes, each with a getter of its own that lays a name. One may be carried out, the other stays. Object.assign out of one variable meets both.
const kept = { raw: 1, get value() { this.read = this.raw; return 7; } };
const carried = { low: 2, more: 3, get value() { this.read = this.low; return 8; } };
let note = "", said = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
for (let i = 0; i < 4; i++) { const held = i & 1 ? kept : carried; const copy = Object.assign({}, held); said += typeof held.read + copy.value + typeof copy.read + " "; }
console.log(said, kept.read, carried.read, note.length);
