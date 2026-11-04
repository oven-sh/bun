// `held.value += 1` reads by the getter and stores by the setter of whichever of two literals the variable holds. One may be carried out, the other stays.
const kept = { raw: 1, get value() { this.reads = (this.reads | 0) + 1; return this.raw; }, set value(next) { this.writes = (this.writes | 0) + 1; this.raw = next; } };
const carried = { low: 2, more: 0, get value() { this.reads = (this.reads | 0) + 1; return this.low; }, set value(next) { this.writes = (this.writes | 0) + 1; this.low = next * 2; } };
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.context = carried; note = error.toString(); }
for (let i = 0; i < 6; i++) { const held = i & 1 ? kept : carried; held.value += 1; held.value++; }
console.log(kept.raw, carried.low, kept.reads, kept.writes, carried.reads, carried.writes, note.length);
