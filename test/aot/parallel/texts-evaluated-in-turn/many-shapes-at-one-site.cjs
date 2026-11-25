// Evaluated text is interpreted in an executable: sites that read and call properties of objects of many shapes, so that what they find is filed beside the site's cache: own, inherited and absent
// names, objects that are the only one of their shape, prototypes that change in the middle, deleted and redefined names, and constructors whose prototype changes.
const { edenGC, fullGC } = require("bun:jsc");
const lines = [];
globalThis.log = (...values) => void lines.push(values.map(value => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? `${value}n` : typeof value === "symbol" ? value.toString() : typeof value === "function" ? "function" : JSON.stringify(value) ?? String(value))).join(" "));
globalThis.collect = () => void fullGC();
globalThis.collectYoung = () => void edenGC();
globalThis.compiledObject = () => ({ a: 1, b: "two" });
globalThis.CompiledClass = class {
  a = 3;
  m() {
    return this.a;
  }
};
const evaluate = text => {
  try {
    log((0, eval)(text));
  } catch (error) {
    log(error instanceof Error ? `${error.name}: ${error.message}` : error);
  }
};

const makers = `[
  () => ({ a: 1 }), () => ({ b: 1, a: 2 }), () => ({ c: 1, b: 2, a: 3 }), () => ({}), () => Object.create({ a: "above" }), () => Object.create(null), () => new One(), () => new Two(), () => new Heir(),
  () => ({ get a() { return "got"; } }), () => Object.freeze({ a: "frozen" }), () => { const o = { a: 1, b: 2 }; delete o.a; return o; }, () => Object.assign([1], { a: "of an array" }), () => Object.assign(function () {}, { a: "of a function" }),
  () => { const o = {}; for (let i = 0; i < 100; i++) o["p" + i] = i; o.a = "of many"; return o; }, () => "text", () => 5, () => compiledObject(), () => new CompiledClass(), () => new Proxy({ a: "proxied" }, {}), () => new Map(),
]`;
for (const change of ["One.prototype.m = () => 'new m'", "Object.defineProperty(One.prototype, 'a', { get() { return 'accessor'; }, configurable: true })", "delete One.prototype.m", "Object.setPrototypeOf(Two.prototype, One.prototype)", "Two.prototype.missing = 'found'", "collect()", "collectYoung()", "for (const o of kept) if (typeof o === 'object') try { delete o.a; } catch {}", "for (const o of kept) if (typeof o === 'object') try { o.missing = 'own'; } catch {}", "for (const o of kept) try { Object.defineProperty(o, 'a', { get() { return 'defined'; }, configurable: true }); } catch {}", "for (const o of kept) try { Object.setPrototypeOf(o, One.prototype); } catch {}", "Function_.prototype = { q: 'other prototype' }", "Function_.prototype = null"])
  evaluate(`(function () {
    class One { m() { return "m of one"; } n = 1; } class Two { b = 1; a = "two"; m() { return "m of two"; } } class Heir extends One { own = 1; get n() { return "n"; } }
    function Function_(x) { this.x = x; this.y = 2; } Function_.prototype.q = "q";
    const answers = [], attempt = f => { try { const x = f(); answers.push(typeof x === "object" && x ? Object.keys(x).join() : typeof x === "function" ? "function" : String(x)); } catch (error) { answers.push(error.name); } };
    const makers = ${makers}, kept = makers.map(make => make());
    const read = o => o.a, absent = o => o.missing, call = o => o.m(), both = o => [o.a, o.b, o.missing].join();
    const births = [x => new Function_(x), x => new One(), x => new Heir(), x => Reflect.construct(Function_, [x], Two), x => new (class extends Function_ { z = 1; })(x), x => new (Function_.bind(null, 7))(), x => new Proxy(Function_, {})(x)];
    const born = birth => { const o = birth(1); return [Object.keys(o).join(), o.q, o.m?.(), o.x, Object.getPrototypeOf(o) === Function_.prototype].join(); };
    for (let turn = 0; turn < 12; turn++) {
      for (const o of kept) for (const site of [read, absent, call, both]) attempt(() => site(o));
      for (const make of makers) for (const site of [read, absent, both]) attempt(() => site(make()));
      for (const birth of births) attempt(() => born(birth));
      if (turn === 6) attempt(() => { ${change}; return "changed"; });
    }
    let hash = 0;
    for (const answer of answers) for (let k = 0; k < answer.length; k++) hash = (Math.imul(hash, 31) + answer.charCodeAt(k)) | 0;
    return [answers.length, hash, ...answers.slice(-140)];
  })()`);
console.log(lines.join("\n"));
