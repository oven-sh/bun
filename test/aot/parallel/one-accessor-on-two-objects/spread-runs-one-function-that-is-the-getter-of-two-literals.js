// One function is laid as an enumerable getter on two literals by written descriptors. One may be carried out, the other stays. A spread and Object.assign of one variable meet both.
function take() { this.read = (this.read | 0) + 1; return 7; }
const kept = { raw: 0 }, carried = { low: 0, more: 1 };
Object.defineProperty(kept, "value", { get: take, enumerable: true });
Object.defineProperty(carried, "value", { get: take, enumerable: true });
let note = "", said = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
for (let i = 0; i < 4; i++) { const held = i & 1 ? kept : carried; const copy = { ...held }, other = Object.assign({}, held); said += held.read + typeof copy.value + typeof other.value + " "; }
console.log(said, kept.read, carried.read, note.length);
