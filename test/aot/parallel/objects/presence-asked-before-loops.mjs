// Loops that ask `"name" in object` of one object: every kind of object, and names that come and go within the loop.
// STATISTIC: SiteCachedReadsHoisted >= 6
const log = []; let effects = 0;
const one = v => typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : v === undefined ? "u" : v === null ? "null" : typeof v;
class Base { constructor() { this.a = 1; } get b() { effects++; return 2; } m() { return 3; } } class Sub extends Base { c = undefined; static s = 1; #p = 1; has(o) { return #p in o; } }
function Old() { this.a = 1; } Old.prototype.b = 2;
const box = JSON.parse('{"o":0}');
const kinds = {
  plain: () => ({ a: 1, c: undefined }), empty: () => ({}), json: () => JSON.parse('{"a":1,"b":[2],"d":null}'), below: () => Object.create({ a: 1, b: undefined }), below2: () => Object.create(Object.create({ a: 1 }, { b: { get() { effects++; return 1; }, enumerable: false } })), bare: () => Object.assign(Object.create(null), { b: 1 }), bareEmpty: () => Object.create(null),
  getter: () => ({ get a() { effects++; return 1; }, set b(v) { effects += 2; } }), base: () => new Base, sub: () => new Sub, klass: () => Sub, old: () => new Old, list: () => [1, 2, , 4], listWith: () => Object.assign([1, 2], { a: 5 }), view: () => new Uint8Array(4), map: () => new Map, fn: () => function named(a, b) { }, arrow: () => x => x, date: () => new Date(0), regexp: () => /x/g, error: () => new Error("e"), args: () => (function () { return arguments; })(1, 2), boxed: () => Object("abc"), boxedNumber: () => Object(5), symbol: () => Object(Symbol.iterator), frozen: () => Object.freeze({ a: 1 }), sealed: () => Object.seal({ b: 1 }),
  deleted: () => { const o = { a: 1, b: 2, c: 3 }; delete o.a; return o; }, many: () => { const o = {}; for (let i = 0; i < 80; i++) o["k" + i] = i; o.b = 1; return o; }, manyDeleted: () => { const o = { a: 1 }; for (let i = 0; i < 80; i++) o["k" + i] = i; delete o.a; delete o.k3; return o; }, keyed: () => { const o = {}; o["a"] = 1; o[1] = 2; return o; },
  proxy: () => new Proxy({ a: 1 }, { has(t, k) { effects += 10; return k in t; } }), proxyPlain: () => new Proxy({ b: 1 }, {}), proxyThrows: () => new Proxy({}, { has() { effects++; throw new RangeError("has"); } }), belowProxy: () => Object.create(new Proxy({ a: 1 }, { has(t, k) { effects += 100; return k === "b"; } })), revoked: () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; },
  global: () => globalThis, math: () => Math, json2: () => JSON, text: () => "abc", number: () => 5, nothing: () => undefined, null: () => null, truth: () => true, big: () => 5n, sym: () => Symbol("x")
};
function unseen(o) { box.o = o; return box.o; }
function kick(o, i) { effects += 1; if (i === 3) { try { o.a = 7; } catch { } } if (i === 5) { try { delete o.b; } catch { } } if (i === 6) { try { Object.setPrototypeOf(o, { c: 1, toString: 1 }); } catch { } } }
const runs = {
  both(o, m, n) { let sum = 0; for (let i = 0; i < n; i++) sum += ("a" in o ? 1 : 0) + ("zz" in o ? 10 : 0); return sum; },
  behind(o, m, n) { let sum = 0; for (let i = 0; i < n; i++) if (i & 1 && "b" in o) sum += i; return sum; },
  field(o, m, n) { let sum = 0; for (let i = 0; i < n; i++) sum += "c" in m.o ? 1 : 2; return sum; },
  variable(o, m, n) { G = o; let sum = 0; for (let i = 0; i < n; i++) sum += "toString" in G ? 1 : 2; return sum; },
  exchanged(o, m, n) { let sum = 0; for (let i = 0; i < n; i++) { sum += "a" in o ? 1 : 2; if (i === 3) o = m; } return sum; },
  stores(o, m, n) { let sum = 0; for (let i = 0; i < n; i++) { sum += "q" in o ? 1 : 2; if (i === 3) o.q = i; } return sum; },
  deletes(o, m, n) { let sum = 0; for (let i = 0; i < n; i++) { sum += "b" in o ? 1 : 2; if (i === 3) delete o.b; } return sum; },
  inherits(o, m, n) { let sum = 0; for (let i = 0; i < n; i++) { sum += "zz" in o ? 1 : 2; if (i === 3) Old.prototype.zz = 1; } return sum; },
  links(o, m, n) { let sum = 0; for (let i = 0; i < n; i++) { sum += "c" in o ? 1 : 2; if (i === 3) Object.setPrototypeOf(o, { c: 1 }); } return sum; },
  kicks(o, m, n) { let sum = 0; for (let i = 0; i < n; i++) { kick(o, i); sum += ("a" in o ? 1 : 2) + ("b" in o ? 10 : 20); } return sum; },
  nested(o, m, n) { let sum = 0; for (let j = 0; j < 2; j++) for (let i = 0; i < n; i++) sum += "a" in o ? 1 : 2; return sum; },
  caught(o, m, n) { let sum = 0; try { for (let i = 0; i < n; i++) sum += "a" in o ? 1 : 2; } catch (e) { sum += 100; } return sum; }
};
let G;
for (const [name, run] of Object.entries(runs)) for (const k in kinds) { if (k === "global" || k === "klass" || (name === "links" && (k === "math" || k === "json2"))) continue; effects = 0; const o = kinds[k](); const m = JSON.parse('{"o":0,"q":0,"a":1}'); m.o = o; let said; try { said = run(unseen(o), m, 9); } catch (e) { said = "threw " + e?.constructor?.name; } delete Old.prototype.zz; delete Math.q; delete JSON.q; delete Sub.q; delete Math.a; delete JSON.a; delete Sub.a; log.push([name, k, said, effects].join(" ")); }
console.log(log.join("\n"));
