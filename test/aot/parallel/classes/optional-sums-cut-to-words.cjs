// `(total + point.sum()) | 0`, where the sum that the method returns has a field that may be undefined: NaN is cut to 0.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
function set(o, n, v) { o[n] = v; }
function setGap(o, n, v) { o[n] = v; }
function setWide(o, n, v) { o[n] = v; }
class Point { constructor(a, b) { this.a = a; this.b = b; this.next = null; } sum() { return this.a + this.b; } difference() { return this.a - this.b; } step(k) { this.a = (this.a + k) & 1023; if (this.next) this.b = this.next.b; return this; } }
function made() { const list = []; for (let i = 0; i < 8; i++) { const c = new Point(i, i + 1); c.next = i ? list[i - 1] : null; set(c, "a", 5); list.push(c); } return list; }
function added(n) { const list = made(); let total = 0; for (let k = 0; k < n; k++) { const c = list[k & 7]; total = (total + c.step(k).sum()) | 0; } return total; }
function subtracted(n) { const list = made(); let total = 0; for (let k = 0; k < n; k++) { const c = list[k & 7]; total = (total - c.step(k).difference()) | 0; } return total; }
function shifted(n) { const list = made(); let total = 0; for (let k = 0; k < n; k++) { const c = list[k & 7]; total ^= (k + c.step(k).sum()) >> 1; } return total; }
function twice(n) { const list = made(); let total = 0; for (let k = 0; k < n; k++) { const c = list[k & 7], d = list[(k + 1) & 7]; total = (c.sum() + d.sum()) | 0; } return total; }
function kept(n) { const list = made(); let total = 0, last = 0; for (let k = 0; k < n; k++) { const c = list[k & 7]; const s = c.step(k).sum(); total = (total + s) | 0; last = s; } return [total, String(last)]; }
tell("added", () => [added(8), added(2000)]);
tell("subtracted", () => [subtracted(8), subtracted(2000)]);
tell("shifted", () => [shifted(8), shifted(2000)]);
tell("twice", () => [twice(8), twice(2000)]);
tell("kept", () => [kept(8), kept(2000)]);
class Gap { constructor(a, b) { this.a = a; this.b = b; this.next = null; } sum() { return this.a + this.b; } step(k) { this.a = (this.a + k) & 1023; if (this.next) this.b = this.next.b; return this; } }
function gaps(n) { const list = []; for (let i = 0; i < 8; i++) { const c = new Gap(i, i + 1); c.next = i ? list[i - 1] : null; setGap(c, "a", 5); if (i === 3) c.b = undefined; list.push(c); } let total = 0; const seen = []; for (let k = 0; k < n; k++) { const c = list[k & 7]; total = (total + c.step(k).sum()) | 0; if (k < 20) seen.push(total); } return [total, seen]; }
tell("gaps", () => [gaps(8), gaps(2000)]);
class Wide { constructor(a, b) { this.a = a; this.b = b; } sum() { return this.a + this.b; } step(k) { this.a = (this.a + k) & 1023; return this; } }
function wide(n) { const list = []; let b = 2147483647; for (let i = 0; i < 8; i++) { const c = new Wide(i, b); b = b * 8 + 1; setWide(c, "a", 5); list.push(c); } let total = 0; for (let k = 0; k < n; k++) { const c = list[k & 7]; total = (total + c.step(k).sum()) | 0; total = (c.sum() + total) ^ k; } return total; }
tell("wide", () => [wide(8), wide(2000)]);
for (const line of out) console.log(line);
