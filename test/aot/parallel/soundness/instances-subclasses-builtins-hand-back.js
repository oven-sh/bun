// Instances of subclasses of built ins hand back their contents.
function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}
class M extends Map {}
class S extends Set {}
class W extends WeakMap {}
class A extends Array {}
class E extends Error {}
class R extends RegExp {}
class D extends Date {}
class U extends Uint8Array {}
class T extends String {}
class N extends Number {}
class F extends Function {}
class B extends ArrayBuffer {}
const item = { name: "item" };
attempt("map", () => { const m = new M([["k", item]]); m.set("l", { name: "later" }); return m.get("k").name + m.get("l").name + [...m.values()].map(v => v.name).join() + [...m.keys()].map(k => k.length).join() + [...m].map(([k, v]) => k + v.name).join() + m.size; });
attempt("map forEach", () => { let t = ""; new M([["k", item]]).forEach((v, k, m) => (t += v.name + k.length + m.size)); return t; });
attempt("set", () => { const s = new S([item]); s.add({ name: "later" }); return [...s].map(v => v.name).join() + [...s.values()].length + [...s.entries()].map(([a, b]) => a.name + b.name).join() + s.has(item) + s.size; });
attempt("set methods", () => [...new S([1, 2]).union(new S([3]))].join() + [...new S([1, 2]).intersection(new Set([2]))].join());
attempt("weak", () => new W([[item, { name: "held" }]]).get(item).name);
attempt("array", () => { const a = new A(); a.push(item); a[1] = { name: "second" }; return a[0].name + a[1].name + a.map(v => v.name).join() + a.length + a.at(-1).name + a.find(v => v.name).name + a.pop().name + a.concat([item])[1].name + a.slice(0)[0].name + [...a][0].name; });
attempt("array from", () => A.from([item])[0].name + A.of(item)[0].name + (A.from([1]) instanceof A) + A.from([item]).filter(() => true)[0].name);
attempt("array loop", () => { let t = ""; for (const v of A.of(item, item)) t += v.name; A.of(item).forEach(v => (t += v.name)); for (const [i, v] of A.of(item).entries()) t += i + v.name; return t; });
attempt("error", () => { const e = new E("message", { cause: item }); return e.message.length + e.cause.name + e.name + (e instanceof E) + typeof e.stack; });
attempt("regexp", () => { const r = new R("(a)(b)?", "g"); const m = r.exec("xab"); return m[1].length + m[2].length + m.index + r.lastIndex + "ab".replace(r, "$1") + r.test("a") + r.source + "aXa".split(new R("X")).join(); });
attempt("date", () => new D(0).getTime() + new D(0).toISOString().length + (new D(5) - new D(2)));
attempt("typed", () => { const u = new U([1, 2, 300]); return u[2] + u.length + u.map(v => v * 2).join() + (u.subarray(1) instanceof U) + u.at(0).toFixed(1) + [...u].join() + U.from([7])[0]; });
attempt("string", () => new T("abc").length + new T("abc")[1].length + new T("abc").toUpperCase() + [...new T("ab")].join() + (new T("a") + "b"));
attempt("number", () => new N(5).toFixed(1) + (new N(5) + 1) + new N(5).valueOf().toString().length);
attempt("buffer", () => new B(8).byteLength + new Uint8Array(new B(2)).length + (new B(4).slice(1) instanceof B));
class P extends Promise {}
P.resolve(item).then(v => console.log("promise", v.name, P.resolve(1) instanceof P));
new P(resolve => resolve(item)).then(v => v.name).then(n => console.log("promise chain", n.length));
P.all([P.resolve(item), item]).then(([a, b]) => console.log("promise all", a.name, b.name));
(async () => console.log("awaited", (await P.resolve(item)).name))();
