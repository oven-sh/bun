class E extends Error { k() { return this.message.length; } }
class T extends TypeError { }
class L extends Array { sum() { let t = 0; for (const x of this) t += x || 0; return t; } }
class M extends Map { }
class P extends Promise { }
class O extends Object { }
class F extends Function { }
globalThis.kept = [E, T, L, M, P, O, F];
function run(n) { let t = 0; for (let i = 0; i < n; i++) { const e = new E("m" + i, { cause: i }); t += e.k() + e.cause + new L(i % 5).length + new L(1, 2, i).sum() + new M([[i, 1]]).size + (new T() instanceof TypeError ? 1 : 0) + (new O(i) instanceof O ? 1 : 0); } return t; }
console.log(run(20000));
console.log(new E("x") instanceof Error, new E("x").name, Object.prototype.toString.call(new L()), Array.isArray(new L(2)), new F("a", "return a + 1")(2));
new P((resolve) => resolve(4)).then((v) => console.log(v, new P(() => { }) instanceof P));
try { new P(); } catch (e) { console.log(e.constructor.name); }
