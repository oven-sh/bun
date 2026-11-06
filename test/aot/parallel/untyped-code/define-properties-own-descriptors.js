// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)): a merge that preserves accessors. The descriptor map does not escape.
const lines = [];
const spell = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d ? ["value", "writable", "get", "set", "enumerable", "configurable"].filter(n => n in d).map(n => n + "=" + (typeof d[n] === "function" ? "function " + d[n].name : typeof d[n] === "object" && d[n] ? JSON.stringify(d[n]) : String(d[n]))).join() : "none"; };
const whole = o => Reflect.ownKeys(o).map(k => String(k) + "{" + spell(o, k) + "}").join(" ");
const show = (title, f) => { let text; try { text = String(f()); } catch (e) { text = "throws " + e.constructor.name + ": " + e.message.split(" (evaluating")[0]; } lines.push(title + ": " + text); };
const merge = (target, source) => Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
const mergeOntoCopy = (base, extra) => Object.defineProperties({ ...base }, Object.getOwnPropertyDescriptors(extra));
const copy = source => Object.defineProperties({}, Object.getOwnPropertyDescriptors(source));
const watched = (target, source) => { try { return Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } catch (e) { return "caught " + e.constructor.name; } };
const kept = (target, source) => { const d = Object.getOwnPropertyDescriptors(source); Object.defineProperties(target, d); return Object.keys(d).join() + " | " + whole(target); };

const symbol = Symbol("own"), other = Symbol("other");
let count = 0;
const sources = {
    empty: () => ({}),
    plain: () => ({ a: 1, b: "two", c: null, d: undefined, e: { deep: true } }),
    getters: () => ({ a: 1, get b() { count++; return "got"; }, set b(v) { lines.push("set b " + v); }, get c() { count++; return 3; }, set d(v) {} }),
    methods: () => ({ m() { return 1; }, arrow: () => 2, f: function () { return 3; }, async n() {}, *g() {} }),
    attributes: () => { const o = {}; Object.defineProperty(o, "hidden", { value: 1, writable: true, configurable: true }); Object.defineProperty(o, "fixed", { value: 2, enumerable: true }); Object.defineProperty(o, "readOnly", { value: 3, enumerable: true, configurable: true }); Object.defineProperty(o, "lockedGetter", { get() { return 4; } }); o.last = 5; return o; },
    symbols: () => ({ [symbol]: 1, z: 2, [other]: 3, a: 4 }),
    indices: () => ({ b: 1, 2: "two", a: 2, 0: "zero" }),
    proto: () => JSON.parse('{"__proto__": 1, "x": 2}'),
    dictionary: () => { const o = {}; for (let i = 0; i < 150; i++) o["p" + i] = i; for (let i = 0; i < 145; i++) delete o["p" + i]; o.after = 1; return o; },
    deleted: () => { const o = { a: 1, b: 2, c: 3 }; delete o.b; o.d = 4; return o; },
    large: () => { const o = {}; for (let i = 0; i < 70; i++) o["k" + i] = i; return o; },
    frozen: () => Object.freeze({ a: 1, b: 2 }),
    instance: () => { class C { x = 1; #p = 2; get y() { return this.#p; } } return new C(); },
    noPrototype: () => Object.assign(Object.create(null), { a: 1 }),
    array: () => [1, 2],
    functionObject: () => function named(a, b) {},
    text: () => "ab",
    number: () => 7,
    nil: () => null,
    missing: () => undefined,
    proxy: () => new Proxy({ a: 1, b: 2 }, { ownKeys(t) { lines.push("ownKeys"); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { lines.push("describe " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); } }),
};
const targets = {
    empty: () => ({}),
    overlapping: () => ({ a: "old a", b: "old b", own: true }),
    overlappingGetter: () => ({ get a() { return "old getter"; }, z: 1 }),
    fixedSame: () => Object.defineProperty({}, "a", { value: 1 }),
    fixedOther: () => Object.defineProperty({ first: 0 }, "a", { value: "fixed" }),
    notExtensible: () => Object.preventExtensions({ a: 0 }),
    frozen: () => Object.freeze({ a: 0 }),
    noPrototype: () => Object.create(null),
    prototypeInUse: () => { const p = {}; const heir = Object.create(p); lines.push("before " + heir.a + " " + heir.b); p.heir = heir; return p; },
    functionObject: () => function target() {},
    array: () => [],
    proxy: () => new Proxy({}, { defineProperty(t, k, d) { lines.push("define " + String(k) + " " + Object.keys(d).join()); return Reflect.defineProperty(t, k, d); } }),
    text: () => "text",
    nil: () => null,
};
for (const source of Object.keys(sources)) {
    for (const target of Object.keys(targets)) {
        show("merge " + source + " onto " + target, () => { const t = targets[target](), s = sources[source](); let r; try { r = merge(t, s); } finally { if (t && typeof t !== "string") lines.push("  target now " + (source === "large" ? Reflect.ownKeys(t).length : whole(t).replace(/heir\{[^}]*\}/, "heir"))); } return (r === t) + (t.heir ? " heir sees " + t.heir.a + " " + t.heir.b : ""); });
    }
    show("copy " + source, () => { const s = sources[source](); const c = copy(s); return (source === "large" ? Reflect.ownKeys(c).length : whole(c)) + " | " + (c !== s) + " " + (Object.getPrototypeOf(c) === Object.prototype) + " " + Object.isExtensible(c) + " " + Object.isFrozen(c); });
    show("onto a copy " + source, () => { const c = mergeOntoCopy({ a: "base a", base: 1, get lazy() { return "evaluated by the spread"; } }, sources[source]()); return source === "large" ? Reflect.ownKeys(c).length : whole(c); });
    show("watched " + source, () => { const r = watched({ a: 0 }, sources[source]()); return typeof r === "string" ? r : source === "large" ? Reflect.ownKeys(r).length : whole(r); });
    show("kept " + source, () => source === "large" ? "" : kept({}, sources[source]()));
}
show("no getter ran", () => count);
show("the same functions", () => { const s = sources.getters(), m = sources.methods(); const c = copy(s), n = copy(m); const d = k => Object.getOwnPropertyDescriptor(s, k), e = k => Object.getOwnPropertyDescriptor(c, k); return [d("b").get === e("b").get, d("b").set === e("b").set, d("c").get === e("c").get, e("c").set, e("d").get, n.m === m.m, n.arrow === m.arrow, n.f === m.f, n.g === m.g].join(); });
show("the copy is its own", () => { const s = sources.getters(); const c = copy(s); Object.defineProperty(c, "b", { get() { return "new"; } }); c.a = 9; return [s.b, c.b, s.a, c.a].join(); });
show("onto itself", () => { const s = sources.attributes(); return (merge(s, s) === s) + " " + whole(s); });
show("getters work on the copy", () => { const c = copy({ n: 2, get twice() { return this.n * 2; } }); c.n = 5; return c.twice; });
show("many, one road", () => { let sum = 0; const extra = { x: 1, get y() { return this.x + 1; }, z: 3 }; for (let i = 0; i < 3000; i++) { const c = mergeOntoCopy({ a: i, x: 0 }, extra); sum += c.a + c.x + c.y + c.z + Object.keys(c).length; } return sum; });
show("many shapes at one place", () => { const out = []; for (let i = 0; i < 30; i++) { const s = {}; for (let j = 0; j <= i % 6; j++) s["f" + ((i + j) % 9)] = j; if (i % 3 === 0) Object.defineProperty(s, "g", { get() { return i; }, enumerable: true, configurable: true }); const c = mergeOntoCopy({ f1: "base", f2: "base" }, s); out.push(Object.keys(c).join("") + (c.g ?? "")); } return out.join(" "); });
show("ever new names", () => { let sum = 0, names = 0; for (let i = 0; i < 1500; i++) { const s = {}; s["id" + i + "a"] = i; s["id" + i + "b"] = i + 1; s["id" + i + "c"] = i + 2; const c = merge({ first: 1 }, s); sum += c["id" + i + "a"] + c["id" + i + "b"] + c["id" + i + "c"] + c.first; names += Object.keys(c).length; } return sum + " " + names; });
show("the same names again behind ever new ones", () => { let sum = 0; for (let i = 0; i < 50; i++) { const c = merge({ first: 1 }, { alpha: i, beta: 2, gamma: 3 }); sum += c.alpha + c.beta + c.gamma + Object.keys(c).length; } return sum; });
show("more than sixty-four", () => { const s = {}; for (let i = 0; i < 90; i++) s["p" + i] = i; const c = merge({}, s); return Object.keys(c).length + " " + c.p0 + " " + c.p89 + " " + Object.keys(c).slice(62, 67).join(); });
show("a source that has lost a property", () => { const s = { a: 1, b: 2, c: 3, d: 4 }; delete s.b; const c = merge({ z: 0 }, s); return JSON.stringify(c); });
function place(error) { const found = /:(\d+):(\d+)\)?$/.exec(String(error.stack).split("\n").filter(line => /mergeForItsPlace/.test(line))[0] || ""); return error.constructor.name + " " + (found ? found[1] + ":" + found[2] : "no place"); }
function mergeForItsPlace(target, source) { const merged = Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); return merged; }
function placeOfError(target, source) { try { mergeForItsPlace(target, source); return "no error"; } catch (error) { return place(error); } }
show("where an error of the inner call is thrown", () => [placeOfError({}, undefined), placeOfError({}, null), placeOfError({}, new Proxy({ a: 1 }, { ownKeys() { throw new RangeError("keys"); } })), placeOfError({}, new Proxy({ a: 1 }, { getOwnPropertyDescriptor() { throw new RangeError("descriptor"); } })), placeOfError({}, { a: 1 })].join(" | "));
console.log(lines.join("\n"));
