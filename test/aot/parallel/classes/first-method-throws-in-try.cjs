"use strict";
const maybe = k => { if (k === 3) throw new RangeError("m"); return k; };
class K { init(x) { this.list = maybe(x); this.text = String(x); this.pos = 0; this.size = x; } }
function read(x) { const o = new K(); try { o.init(x); } catch (e) { return ["caught", o.text, o.pos, o.size].join(); } return [o.text, o.pos].join(); }
for (const x of [1, 2, 3, 4]) console.log(read(x));
