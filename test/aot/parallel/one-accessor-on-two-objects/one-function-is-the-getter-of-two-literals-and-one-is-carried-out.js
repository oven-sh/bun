// One function is laid as the getter on two literals of different shapes by written descriptors. One literal may be carried out, the other stays; one read meets both.
function take() { this.read = 1; return 7; }
const kept = { raw: 0 }, carried = { low: 0, more: 1 };
Object.defineProperty(kept, "value", { get: take });
Object.defineProperty(carried, "value", { get: take });
function look(held) { const got = held.value; return got + typeof held.read; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(look(kept), look(carried), typeof kept.read, typeof carried.read, note.length);
