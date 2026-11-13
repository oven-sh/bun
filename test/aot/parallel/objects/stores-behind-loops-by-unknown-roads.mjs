// A number that comes round is stored behind the turns that are laid out, where another arm of the turn stores into an object of another shape.
class Point { constructor(m) { this.m = m; this.k = 1; } }
class Wide extends Point { constructor(m) { super(m); this.z = 2; } }
class Watched { constructor() { this.sets = []; } get m() { return this.sets.length; } set m(v) { this.sets.push(v); } }
function down(p, m) { for (let i = m; i-- > 0;) p.m = i; }
function downToOne(p, m) { for (let i = m; i-- > 1;) p.m = i; return p.m; }
function whileDown(p, m) { let i = m; while (i-- > 0) p.m = i; return i; }
function downAndReads(p, m) { let s = 0; for (let i = m; i-- > 0;) { p.m = i; s += i; } return s; }
function downFrom(p, m, low) { for (let i = low + m; i-- > low;) p.m = i; }
function lessAndLess(p, m) { let s = 0; for (let i = 0; i < m; i++) { s -= i; p.m = s; } }
function sumsOfHalves(p, m) { let t = 0.25; for (let i = 0; i < m; i++) { t += 0.5; p.m = t; } return t; }
function twoFields(p, m) { let t = 0.5; for (let i = m; i-- > 0;) { t -= 1.25; p.m = t; p.k = i; } return t; }
function twoNames(p, q, m) { for (let i = m; i-- > 0;) { p.m = i; q.k = i; } }
function breaks(p, m) { for (let i = m; i-- > 0;) { p.m = i; if (i === 7) break; } }
function continues(p, m) { let s = 0; for (let i = m; i-- > 0;) { if (i === 7) continue; s += i; p.m = s; } }
function element(list, m) { for (let i = m; i-- > 0;) list[0].m = i; }
function inTry(p, m) { try { for (let i = m; i-- > 0;) p.m = i; } catch (e) { return e.constructor.name; } return p.m; }
function nested(p, m) { let t = 0.5; for (let o = 0; o < 3; o++) for (let i = m; i-- > 0;) { t += i; p.m = t; } return t; }
function negative(p, m) { let t = -0; for (let i = m; i-- > 0;) { t = -t; p.m = t; } }
class Holder { constructor() { this.n = 0.5; } count(m) { for (let i = m; i-- > 0;) this.n = i; return this.n; } }
const text = v => Object.is(v, -0) ? "-0" : v !== null && typeof v === "object" ? Reflect.ownKeys(v).map(key => `${key}:${Array.isArray(v[key]) ? v[key].length : text(v[key])}`).join() : String(v);
const tried = f => { try { return text(f()); } catch (e) { return e.constructor.name; } };
const counts = [40, 0, 1, 2, 3, 5, 8, 9, 17, 100, 7.5, -3, NaN];
for (const m of counts) {
  const p = Array.from({ length: 16 }, () => new Point(0.25));
  const said = [down(p[0], m), downToOne(p[1], m), whileDown(p[2], m), downAndReads(p[3], m), lessAndLess(p[4], m), sumsOfHalves(p[5], m), twoFields(p[6], m), twoNames(p[7], p[8], m), twoNames(p[9], p[9], m), breaks(p[10], m), continues(p[11], m), element([p[12]], m), inTry(p[13], m), nested(p[14], m), negative(p[15], m), new Holder().count(m)];
  console.log(m, said.map(text).join(" "), p.map(text).join(" "));
  for (const low of [2147483640, -2147483660, 4294967290, 9007199254740000, 0.5, -5]) { const p = new Point(0.25); downFrom(p, m, low); console.log(text(p)); }
}
// Objects of other shapes come by roads that nobody follows.
const makers = [() => new Point(0.25), () => new Point("a"), () => new Point(3), () => new Wide(0.5), () => ({ k: 2, m: "s" }), () => Object.freeze(new Point(0.75)), () => new Watched(), () => new Proxy(new Point(1.5), {}), () => Object.create(new Point(0.5)), () => null];
const functions = [down, downToOne, whileDown, downAndReads, lessAndLess, sumsOfHalves, twoFields, breaks, continues, inTry, nested, negative];
for (const m of counts) {
  for (const [k, make] of makers.entries()) {
    const said = [];
    for (const f of functions) { const p = make(); said.push(tried(() => Reflect.apply(f, undefined, [p, m])), tried(() => text(p))); }
    console.log(m, k, said.join(" "));
  }
}
