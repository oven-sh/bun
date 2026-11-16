function f0(l, o, k) { let s = 0, i = 0; let u = l[0]; while (u) { u.w++; u.p.x = (0.5 - (5 - u.q.y)); u = u.next; i++; if (i > 12) break; } return s; }
function f1(h, o, k) { let s = 0, i = 0; for (const u of h.list) { u.p.n = ((k & u.p.w) | (u.y + -3)); i++; } return s; }
function f2(l, o, k) { let s = 0; l.forEach((u, i) => { u.p.x++; u.p.x += (0.5 - i); u.p.n = k; }); return s; }
function f3(l, o, k) { let s = 0, i = 0; for (const u of l) { u.y -= (u.q.w + 0.5); if (i > u.y) { u.p.w++; } u.p.n += u.w; i++; } return s; }
function f4(l, o, k) { let s = 0, i = 0; for (const u of l) { u.p.x = o.n; i++; } return s; }
function f5(l, o, k) { let s = 0, i = 0; for (const u of l) { u.q.n = k; u.p.w = (i + (i * 1)); u.p.x += (u.y & 0.5); i++; } return s; }
function f6(h, o, k) { let s = 0, i = 0; for (const u of h.list) { s = (s + (o.n + u.w)) | 0; u.p.n = ((u.q.n + i) * (0 * u.q.w)); u.w = u.q.y; u.p.y = (k & (0.5 & u.p.x)); i++; } return s; }
function f7(h, o, k) { let s = 0, i = 0; for (const u of h.list) { const t1 = u.y; u.p.w = t1; u.q.n -= (8 & k); u.p.n -= u.p.x; i++; } return s; }
function f8(l, o, k) { let s = 0, i = 0; for (const u of l) { u.p.y = u.x; i++; } return s; }
let heard = 0;
const texts = process.argv.length > 99 ? [] : ['{"x":1,"y":2.5,"n":3,"w":4,"p":{"x":5,"y":6,"n":7.5,"w":8},"q":{"w":1,"n":2,"y":3,"x":4}}', '{"w":9,"p":{"n":1,"x":0.5,"y":2,"w":3},"y":8,"q":{"x":1,"y":1,"n":1,"w":1},"x":7,"n":6}'];
const one = k => JSON.parse(texts[k & 1]);
const list = n => { const l = Array.from({ length: n }, (_, k) => { const u = one(k); u.x = k; return u; }); l.forEach((u, k) => (u.next = l[k + 1] ?? null)); return l; };
const changed = change => () => { const l = list(6); change(l); return l; };
class Below { set x(v) { heard += 1; this.held = v; } get x() { return this.held ?? 3; } }
const kinds = {
  plain: () => list(6),
  short: () => list(2),
  text: changed(l => { l[2].x = "a"; l[4].p.y = "b"; }),
  missing: changed(l => { delete l[3].x; delete l[2].p.y; }),
  noInner: changed(l => { l[4].p = undefined; }),
  numberInner: changed(l => { l[3].q = 5; }),
  same: changed(l => { l[1] = l[0]; l[3] = l[0]; }),
  sharedInner: changed(l => { for (const u of l) u.p = l[0].p; }),
  crossed: changed(l => { for (const u of l) u.q = u.p; }),
  itself: changed(l => { l[2].p = l[2]; l[4].q = l[4]; }),
  getter: changed(l => Object.defineProperty(l[2], "x", { get: () => ++heard, configurable: true })),
  setter: changed(l => Object.defineProperty(l[3].p, "y", { get: () => 4, set: v => { heard += 10; } })),
  readOnly: changed(l => Object.defineProperty(l[3], "n", { writable: false })),
  readOnlyInner: changed(l => Object.defineProperty(l[2].p, "x", { writable: false })),
  frozen: changed(l => { Object.freeze(l[3]); Object.freeze(l[4].p); }),
  sealed: changed(l => { Object.seal(l[1]); Object.preventExtensions(l[2].p); }),
  inherited: changed(l => { l[2] = Object.create(l[2]); }),
  above: changed(l => { delete l[2].x; Object.setPrototypeOf(l[2], Below.prototype); }),
  proxy: changed(l => { l[3].p = new Proxy(l[3].p, { get: (t, k) => (heard += 2, t[k]), set: (t, k, v) => (heard += 3, (t[k] = v), true) }); }),
  dictionary: changed(l => { for (let i = 0; i < 70; i++) l[1]["z" + i] = i; for (let i = 0; i < 70; i++) delete l[1]["z" + i]; }),
  wide: changed(l => { for (let i = 0; i < 30; i++) l[2].p["z" + i] = i; }),
  array: changed(l => { l[2].p = Object.assign([1, 2], one(1).p); }),
  callable: changed(l => { l[3].q = Object.assign(() => 1, one(1).p); }),
  regexp: changed(l => { l[3].p = Object.assign(/a/, one(1).p); }),
  primitive: changed(l => { l[4] = 7; }),
  string: changed(l => { l[3] = "u"; }),
  nothing: changed(l => { l[4] = null; }),
  hole: changed(l => { delete l[3]; }),
  bigint: changed(l => { l[2].x = 5n; }),
  odd: changed(l => { l[1].x = NaN; l[2].y = -0; l[3].n = Infinity; l[4].w = 2147483647; l[0].p.x = -2147483648; }),
  stops: changed(l => { l[3].y = "stop"; }),
  changing: changed(l => { let turn = 0; Object.defineProperty(l[2], "p", { get: () => (turn++ ? l[0].p : l[1].p), configurable: true }); }),
};
const show = v => typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "number" || typeof v === "string" || v == null || typeof v === "boolean" ? String(v) : typeof v;
const flat = (u, depth = 2) => u === null || (typeof u !== "object" && typeof u !== "function") ? show(u) : depth ? "{" + Object.keys(u).filter(k => k[0] !== "z" && k !== "next").map(k => { const d = Object.getOwnPropertyDescriptor(u, k); return k + ":" + ("value" in d ? flat(d.value, depth - 1) : "accessor"); }).join() + "}" : typeof u;
const functions = [f0, f1, f2, f3, f4, f5, f6, f7, f8], takesHolder = [false, true, false, false, false, false, true, true, false];
for (let round = 0; round < 2; round++)
  for (const name in kinds)
    for (let f = 0; f < functions.length; f++) {
      const l = kinds[name](), o = round ? l[2] ?? one(1) : one(0);
      let answer;
      try { answer = show(functions[f](takesHolder[f] ? { list: l } : l, o, f)); } catch (error) { answer = error.constructor.name; }
      console.log(name, f, answer, heard, flat(o), Array.from(l, u => flat(u)).join("|"));
    }
