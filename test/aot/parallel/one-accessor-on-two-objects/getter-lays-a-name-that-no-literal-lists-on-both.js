// The getter lays a name that neither literal lists. One of the two may be carried out in an arm that does not run; the read meets both.
function make(raw) { return { raw, get value() { this.read = this.raw; return 7; } }; }
function look(held) { const got = held.value; return got + typeof held.read; }
const kept = make(1), carried = make(2);
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(look(kept), look(carried), typeof kept.read, typeof carried.read, note.length);
