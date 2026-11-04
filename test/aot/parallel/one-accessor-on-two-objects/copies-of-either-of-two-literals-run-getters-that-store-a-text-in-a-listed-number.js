// Two literals of different shapes, each with a getter of its own that stores a text where the literal lists a number. One may be carried out, the other stays. A spread and Object.assign of one variable meet both.
const kept = { raw: 1, read: 0, get value() { this.read = "r" + this.read; return 7; } };
const carried = { low: 2, more: 3, read: 0, get value() { this.read = "q" + this.read; return 8; } };
let note = "", said = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
for (let i = 0; i < 4; i++) { const held = i & 1 ? kept : carried; const copy = { ...held }, other = Object.assign({}, held); said += typeof held.read + copy.value + typeof copy.read + typeof other.read + " "; }
console.log(said, kept.read + 1, carried.read + 1, note.length);
