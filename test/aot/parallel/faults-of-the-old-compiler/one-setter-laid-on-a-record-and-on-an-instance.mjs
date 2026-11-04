class Row { raw = 0; dirty = false; }
function track(t) { Object.defineProperty(t, "value", { get() { return this.raw; }, set(v) { this.raw = v; this.dirty = true; } }); return t; }
function touch(t, v) { t.value = v; return t.dirty === true ? "dirty" : "clean"; }
const rec = track({ raw: 0, dirty: false });
let note = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (e) { e.context = rec; note = e.toString(); }
console.log(touch(track(new Row()), 5), touch(rec, 5));
console.log(note.length);
