"use strict";
// The method that fills a new object throws at one of its stores, and a handler, a finally block, a later iteration or another function sees what it has left empty.
const out = [];
let place = 0;
const at = (n, value) => { if (n === place) throw new RangeError("at" + n); return value; };
class K {
  init(x) { this.list = at(1, x); this.text = at(2, String(x)); this.pos = at(3, 0); this.size = at(4, x); this.more = at(5, true); return this; }
  scan(k) { let t = 0; while (this.pos < k) { t += this.size; this.pos++; } return t; }
  show() { return [this.list, this.text, this.pos, this.size, this.more, Object.keys(this).length].join(); }
}
class L { open(x) { this.text = at(1, "t" + x); this.pos = at(2, x); } next() { return this.text.length + this.pos++; } show() { return [typeof this.text, this.text, this.pos].join(); } }
function caught(x) { const o = new K(); try { o.init(x); } catch (e) { return ["caught", o.text, o.pos, o.size, o.show()].join(); } return o.show() + o.scan(3); }
let kept = null;
function finished(x) { const o = new K(); try { o.init(x); } finally { kept = o; } return o.pos + o.scan(2); }
function behind(x) { const o = new K(); try { o.init(x); } catch (e) { out.push(e.message); } return o.show() + o.scan(2); }
function inside(x) { try { const o = new K(); o.init(x); return o.show(); } catch (e) { return e.message; } }
function assigned(x) { let o; try { o = new K(); o.init(x); } catch (e) { return e.message + (o && o.show()); } return o.scan(2) + o.show(); }
function nested(x) { const o = new K(); try { try { o.init(x); } catch (e) { out.push("inner"); throw e; } finally { out.push("finally"); } } catch (e) { return o.show(); } return o.show(); }
function around(list) { const o = new K(); let s = ""; for (let i = 0; i < list.length; i++) { try { o.init(list[i]); s += o.show(); } catch (e) { s += e.message; place = 0; } } return s; }
function later(list) { const o = new K(); let s = ""; for (let i = 0; i < list.length; i++) { try { o.init(list[i]); } catch (e) { s += "x"; } s += o.pos + o.show(); } return s; }
function closes(list) { const o = new K(); let s = ""; for (const x of list) { o.init(x); s += o.show(); } return s; }
function* iterate() { const o = new K(); try { o.init(1); yield o.show(); } catch (e) { yield e.message + o.show(); } finally { out.push("end" + o.pos); } }
function* thrownAt() { const o = new K(); try { yield 1; o.init(2); yield o.show(); } catch (e) { yield "caught" + o.show(); } }
function unknownMethod(x) { const o = new K(); try { if (x) o.missing(); else o.init(x); } catch (e) { return e.constructor.name + o.show(); } return o.show(); }
function early(x) { const o = new L(); try { out.push(at(1, "a")); o.open(x); } catch (e) { return o.show(); } return o.show() + o.next(); }
class Holder { constructor(x) { this.l = new L(); this.l.open(x); this.x = x; } get() { return this.l.next() + this.x; } }
let made = null;
class Watcher { constructor(x) { made = this; this.l = new L(); this.l.open(x); } }
class Careful { constructor(x) { try { this.l = new L(); this.l.open(x); } catch (e) { this.error = this.l.show(); } } }
const run = (f) => { try { return String(f()); } catch (e) { return e.constructor.name + e.message.slice(0, 5); } };
for (place = 0; place < 6; place++) {
  const now = place;
  for (const f of [caught, finished, behind, inside, assigned, nested, early, unknownMethod]) { place = now; out.push(f.name + run(() => f(4)) + (kept ? kept.show() + (kept.pos + 1) : "")); kept = null; }
  for (const f of [around, later, closes]) { place = now; out.push(f.name + run(() => f([1, 2, 3]))); }
  place = now;
  out.push(run(() => [...iterate()].join()), run(() => { const g = thrownAt(); g.next(); return g.throw(new Error("in")).value; }), run(() => { const g = iterate(); g.next(); return JSON.stringify(g.return(7)); }));
  out.push(run(() => new Holder(2).get()), run(() => new Watcher(3).l.show()), made ? run(() => made.l.show()) : "", run(() => { const c = new Careful(5); return c.error ?? c.l.show(); }));
  made = null;
  place = now;
}
async function rejected(p, n) { const o = new K(); try { o.init(await p); return o.show(); } catch (e) { return "rejected" + o.show(); } finally { out.push("f" + o.pos); } }
(async () => {
  for (const n of [0, 1, 3, 5]) { place = n; out.push(await rejected(Promise.resolve(n), n)); place = 0; out.push(await rejected(Promise.reject(new Error("p")), n)); }
  for (const line of out) console.log(line);
})();
