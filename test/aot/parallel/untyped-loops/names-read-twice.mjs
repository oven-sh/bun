let heard = 0;
const sum = t => { let s = 0; for (let i = 0; i < t.length; i++) { const u = t[i]; s += u.p.x * u.p.x + u.p.y * u.p.y; } return s; };
const square = t => { let s = 0; for (const u of t) s += u.k * u.k - u.k; return s; };
const either = t => { let s = 0; for (let i = 0; i < t.length; i++) { if (t[i].k > 2) s += t[i].k; else s -= t[i].k * t[i].p.x; } return s; };
const chosen = t => { let s = 0; for (let i = 0; i < t.length; i++) { const u = t[i]; s += u.k ? u.k * 2 : u.p.x - u.p.y; s = s - u.p.x; } return s; };
const between = (t, o) => { let s = 0; for (let i = 0; i < t.length; i++) { const u = t[i]; s += u.p.x; o.x = i; s += u.p.x * 2; } return s; };
const replaced = (t, q) => { let s = 0; for (let i = 0; i < t.length; i++) { const u = t[i]; s += u.p.x; u.p = q; s += u.p.x + u.p.y; } return s; };
const text = t => { let s = ""; for (let i = 0; i < t.length; i++) { const u = t[i]; s += u.k; if (u.k !== 3) s += u.k + u.k; } return s; };
const nested = t => { let s = 0; for (let i = 0; i < t.length; i++) for (let j = 0; j < t.length; j++) s += t[i].k * t[j].k + t[i].k - t[j].p.x; return s; };
const called = t => { let s = 0; for (let i = 0; i < t.length; i++) { s += t[i].k; s += Math.max(t[i].k, t[i].p.x) + t[i].k; } return s; };
const negated = t => { let s = 0; for (const u of t) { const a = -u.p.x, b = ~u.k; s += a + b + u.p.x + u.k; } return s; };
const json = process.argv.length > 99 ? "[]" : JSON.stringify(Array.from({ length: 6 }, (_, i) => Object.fromEntries([["k", i], ["p", Object.fromEntries([["x", i + 0.5], ["y", i * 2]])]])));
const fresh = () => JSON.parse(json);
const change = apply => () => { const t = fresh(); apply(t); return t; };
const kinds = {
  plain: fresh,
  text: change(t => { t[3].k = "seven"; }),
  digits: change(t => { t[2].k = "4"; t[4].p.x = "5"; }),
  missing: change(t => { delete t[4].k; }),
  undefinedInner: change(t => { t[4].p = {}; }),
  noInner: change(t => { t[4].p = undefined; }),
  nullInner: change(t => { t[5].p = null; }),
  numberInner: change(t => { t[1].p = 7; }),
  getter: change(t => Object.defineProperty(t[2], "k", { get: () => ++heard })),
  innerGetter: change(t => Object.defineProperty(t[2].p, "x", { get: () => (heard += 2) })),
  changing: change(t => { let turn = 0; Object.defineProperty(t[3], "p", { get: () => (turn++ & 1 ? { x: "a", y: 1 } : { x: 1, y: "b" }) }); }),
  proxy: change(t => { t[1] = new Proxy(t[1], { get: (target, key) => (heard += 3, target[key]) }); }),
  inherited: change(t => { t[2] = Object.create(t[2]); }),
  above: change(t => { const own = t[2]; delete own.k; Object.setPrototypeOf(own, { k: 11 }); }),
  bigint: change(t => { t[3].k = 5n; }),
  nan: change(t => { t[0].k = NaN; t[1].p.x = -0; t[2].p.y = Infinity; }),
  shared: change(t => { for (const u of t) u.p = t[0].p; }),
  itself: change(t => { t[2].p = t[2]; t[2].x = 3; t[2].y = 4; }),
  frozen: change(t => t.forEach(u => Object.freeze(u.p))),
  sealed: change(t => t.forEach(Object.seal)),
  holes: change(t => { delete t[3]; }),
  dictionary: change(t => { for (let i = 0; i < 80; i++) t[1]["z" + i] = i; for (let i = 0; i < 80; i++) delete t[1]["z" + i]; }),
  throws: change(t => Object.defineProperty(t[4].p, "y", { get() { throw new RangeError("y"); } })),
  object: () => ({ length: 3, 0: { k: 1, p: { x: 1, y: 2 } }, 1: { k: 2, p: { x: 2, y: 3 } }, 2: { k: 3, p: { x: 3, y: 4 } } }),
};
const show = value => (typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : JSON.stringify(value) ?? String(value));
const attempt = run => { try { return show(run()); } catch (error) { return error.constructor.name; } };
for (const name in kinds)
  for (let round = 0; round < 3; round++) {
    const line = [sum, square, either, chosen, text, nested, called, negated].map(run => attempt(() => run(kinds[name]())));
    const own = kinds[name]();
    line.push(attempt(() => between(own, own[1]?.p ?? {})), attempt(() => between(own, own[2])), attempt(() => replaced(kinds[name](), { x: "q", y: 2 })), attempt(() => replaced(kinds[name](), { x: 0.5, y: 2 })));
    console.log(name, line.join(" "), heard);
  }
