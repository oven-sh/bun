// What is thrown behind a loop that carried it is the object that the handler sees, also where nothing else stands between.
const kept = [];
function boom(i) { if (i > 2) throw new Error("boom"); }
class V { #x; constructor(x, y) { this.#x = x; this.y = y; } get x() { return this.#x; } set x(v) { this.#x = v; } next() { return new V(this.#x + 1, this.y); } }
const forms = [
  n => { let q = { v: 0 }; try { for (;;) { if (q.v >= n) throw q; q = { v: q.v + 1 }; } } catch (e) { return JSON.stringify(e) + (e === q); } },
  n => { let q = { v: 0 }; try { for (;;) { if (q.v >= n) { q.v = -1; throw q; } q = { v: q.v + 1 }; } } catch (e) { return JSON.stringify(e) + (e === q) + q.v; } },
  n => { let q = { v: 0 }; try { for (let i = 0; i < n; i++) q = { v: q.v + i }; throw q; } catch (e) { return e.v + String(e === q); } },
  n => { let q = { v: 0 }; try { for (let i = 0; i < n; i++) q = { v: q.v + i }; q.v += 0.5; throw [q]; } catch (e) { return e[0].v + String(e[0] === q); } },
  n => { let q = [0, 1]; try { for (let i = 0; i < n; i++) q = [q[1], q[0] + i]; q[0] = "w"; boom(9); } catch { return q.join(); } },
  n => { let q = [0, 1]; try { for (;;) { if (q[0] >= n) throw q; q = [q[0] + 1, q[1]]; } } catch (e) { return e === q ? "same" + q : "other"; } },
  n => { let q = new V(0, 1); try { for (;;) { if (q.x >= n) { q.x = 77; throw q; } q = q.next(); } } catch (e) { return e.x + String(e === q) + q.x; } },
  n => { let q = { v: 0 }, t = ""; for (let r = 0; r < 3; r++) { try { for (;;) { if (q.v >= n + r) throw q; q = { v: q.v + 1 }; } } catch (e) { t += (e === q) + String(q.v); e.v += 10; t += q.v + ";"; } finally { kept.push(q); } } return t + (kept.at(-1) === q); },
  n => { let q = { v: 0 }; try { try { for (;;) { if (q.v >= n) throw q; q = { v: q.v + 1 }; } } finally { q.v = "f"; } } catch (e) { return e.v + String(e === q); } },
  n => { let a = { v: 0 }, b = { v: 1 }; try { for (;;) { if (a.v >= n) throw { a, b }; const c = a; a = { v: a.v + 1 }; b = { v: c.v }; } } catch (e) { return String(e.a === a) + (e.b === b) + a.v + b.v; } },
  n => { let q = { v: 0 }; try { for (;;) { if (q.v >= n) return q.v + "r"; q = { v: q.v + 1 }; boom(q.v); } } catch (e) { return e.message + q.v; } },
];
for (let round = 0; round < 3; round++) for (const n of [0, 1, 2, 5]) console.log(round, n, forms.map(f => f(n)).join(" | "), kept.splice(0).map(q => q.v).join());
