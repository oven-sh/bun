// An iteration stores twice into a field of an object that it has allocated, creates another field on it and then finds a late field empty, so that it restarts.
function attempt(n, f) { let r; try { r = JSON.stringify(f()); } catch (e) { r = "threw " + e.message; } console.log(n + r); }
class C1 { constructor(x) { } init(x, i) { this.ctx = 1; this.ctx = { z: i }; return this; } step(x, i) { for (let j = 0; j < 3; j++) this.kind = j; } }
function put1(o, i) { o.kind += 1; o.n += 1; }
function set1(o, i) { o.val ??= i; var zset1 = o; zset1.kind = "s"; for (let j = 0; j < 3; j++) o.n = j; }
attempt("1", () => {
  const l = [];
  for (let i = 0; i < 4; i++) {
    try { const o = new C1(1).init(2, 1); l.push(put1(o, i)); { l.push(Object.keys(o).join()); } } catch (e) { l.push("T" + e.name); }
    try { const o = Object.defineProperty(new C1(1), "pos", { get() { return "og"; }, configurable: true }); l.push(set1(o, i)); { l.push(Object.keys(o).join()); } } catch (e) { l.push("T" + e.name); }
  }
  return [l];
});
