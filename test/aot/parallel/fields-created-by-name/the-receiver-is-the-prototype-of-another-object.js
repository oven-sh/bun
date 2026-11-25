const unseen = (x) => [x][JSON.parse("0")], no = JSON.parse("false");
class Ash { constructor(early) { this.first = 1; if (early) this.late = 0; this.last = 2; } } class Elm { constructor(early) { this.zero = 0; this.first = 1; if (early) this.late = 0; this.last = 2; } }
const make = (n) => unseen(JSON.parse(String(n % 2)) ? new Elm(no) : new Ash(no));
function lay(o, v) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; o.late = v; } function peek(o) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return o.late; }
for (let n = 0; n < 2; n++) { const box = make(n), kid = unseen(Object.create(box)), before = String(peek(kid)) + String(peek(kid)); lay(box, JSON.parse("7")); console.log(n, before, String(peek(kid)), "late" in kid, Object.keys(kid).length, Object.keys(box).join()); }
