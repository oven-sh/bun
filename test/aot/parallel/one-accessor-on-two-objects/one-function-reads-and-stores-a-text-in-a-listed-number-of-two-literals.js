// One function is the getter of two literals by written descriptors and stores a text where both list a number. One literal may be carried out, the other stays; one read meets both.
function take() { this.read = "r" + this.read; return 7; }
const kept = { raw: 0, read: 0 }, carried = { low: 0, more: 1, read: 0 };
Object.defineProperty(kept, "value", { get: take });
Object.defineProperty(carried, "value", { get: take });
function look(held) { const got = held.value; return got + typeof held.read; }
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
console.log(look(kept), look(carried), kept.read + 1, carried.read + 1, note.length);
