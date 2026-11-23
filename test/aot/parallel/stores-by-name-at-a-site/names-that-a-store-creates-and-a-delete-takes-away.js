const unseen = (x) => [x][JSON.parse("0")];
class Tray { constructor(id, full) { this.id = id; if (full) this.lid = 0; } }
class Pot { constructor(id) { this.lid = 9; this.id = id; } }
function put(o, v) { "use strict"; let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; o.note = v; return w; }
function cap(o, v) { "use strict"; let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; o.lid = v; return w; }
function more(o, v) { "use strict"; let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; o.extra = v; return w; }
function names(o) { let s = ""; for (const k in o) s += k + "+"; return s; }
const note = JSON.parse('"note"');
const out = [];
function turn(i) {
  let w = 0; for (let k = 0; k < 2; k++) w = (w + k) | 0;
  const o = unseen(i % 3 === 0 ? new Tray(i, JSON.parse("false")) : i % 3 === 1 ? new Pot(i) : JSON.parse('{"id":0}'));
  put(o, i); cap(o, i); more(o, i);
  if (i % 2) { delete o[note]; put(o, -i); }
  if (i >= 894) out.push([i, Object.keys(o).join("+"), names(o), JSON.stringify(o)].join("|"));
}
for (let i = 0; i < 900; i++) turn(i);
console.log(out.join("\n"));
