"use strict";
const maybe = k => { if (k === 3) throw new RangeError("m"); return k; };
class K { init(x) { this.list = maybe(x); this.text = String(x); this.pos = 0; this.size = x; } }
let kept = null;
function read(x) { const o = new K(); try { o.init(x); } finally { kept = o; } return o.pos; }
for (const x of [1, 2, 3, 4]) { try { console.log(read(x)); } catch (e) { console.log(e.name, kept.text, kept.pos, Object.keys(kept).join()); } console.log(kept.pos + 1); }
