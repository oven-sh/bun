// each maker alone in a function of its own that reads at once, so that nothing is joined
function probe(label, run) { let text; try { text = String(run()); } catch (e) { text = "threw " + e.constructor.name; } console.log(label + " " + text); }
const key = "a".slice();
probe("setterBehind", () => { const o = { a: 1.5, set a(v) {} }; return o.a + 1; });
probe("getterBehind", () => { const o = { a: 1.5, get a() { return undefined; } }; return o.a + 1; });
probe("again", () => { const o = { a: 1.5, a: undefined }; return o.a + 1; });
probe("computedUnknown", () => { const o = { a: 1.5, [key]: undefined }; return o.a + 1; });
probe("spreadBehind", () => { const o = { a: 1.5, ...{ a: undefined } }; return o.a + 1; });
probe("definedBehind", () => { const o = { a: 1.5 }; Object.defineProperty(o, "a", { get: undefined }); return o.a + 1; });
probe("definedByKey", () => { const o = { a: 1.5 }; Object.defineProperty(o, key, { set(v) {} }); return o.a + 1; });
probe("reflectDeleted", () => { const o = { a: 1.5 }; Reflect.deleteProperty(o, key); return o.a + 1; });
probe("proxyDeleted", () => { const o = { a: 1.5 }; delete new Proxy(o, {}).a; return o.a + 1; });
probe("storedThenDeleted", () => { const o = {}; o.a = 1.5; delete o[key]; return o.a + 1; });
probe("storedUnderSetter", () => { const o = Object.create({ set a(v) {} }); o.a = 1.5; return o.a + 1; });
probe("literalUnderSetter", () => { const o = { __proto__: { set a(v) {} } }; o.a = 1.5; return o.a + 1; });
probe("literalUnderReadOnly", () => { "use strict"; const o = { __proto__: Object.freeze({ a: "fixed" }) }; try { o.a = 1.5; } catch (e) {} return o.a + 1; });
