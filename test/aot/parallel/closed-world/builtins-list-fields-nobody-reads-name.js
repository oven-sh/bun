// A field that no code reads by name is listed by every built-in that goes over the keys of an object.
const log = (...a) => console.log(a.map(String).join(" "));
import util from "node:util";
class C1 { constructor() { this.a = 1; this.hidden = "h"; } } log(1, JSON.stringify(new C1()));
class C2 { constructor() { this.a = 1; this.hidden = "h"; } } log(2, Object.keys(new C2()).join());
class C3 { constructor() { this.a = 1; this.hidden = "h"; } } console.log(3, new C3());
class C4 { constructor() { this.a = 1; this.hidden = "h"; } } log(4, util.inspect(new C4()), Bun.inspect(new C4()));
class C5 { constructor() { this.a = 1; this.hidden = "h"; } } log(5, JSON.stringify({ ...new C5() }));
class C6 { constructor() { this.a = 1; this.hidden = "h"; } } log(6, JSON.stringify(Object.assign({}, new C6())));
class C7 { constructor() { this.a = 1; this.hidden = "h"; } } log(7, JSON.stringify(structuredClone(new C7())));
class C8 { constructor() { this.a = 1; this.hidden = "h"; } } { const ks = []; for (const k in Object.create(new C8())) ks.push(k); log(8, ks.join()); }
class C9 { constructor() { this.a = 1; this.hidden = "h"; } } log(9, Object.keys(new Proxy(new C9(), {})).join(), Reflect.ownKeys(new C9()).join());
class C10 { constructor() { this.a = 1; this.hidden = "h"; } } log(10, Bun.deepEquals(new C10(), { a: 1 }), Bun.deepEquals(new C10(), { a: 1, hidden: "h" }), util.isDeepStrictEqual({ ...new C10() }, { a: 1, hidden: "h" }));
class C11 { constructor() { this.a = 1; this.hidden = "h"; } } log(11, Object.entries(new C11()).join(";"), Object.values(new C11()).join(), JSON.stringify(Object.getOwnPropertyDescriptors(new C11())));
class C12 { constructor() { this.a = 1; this.hidden = "h"; } } { const { a, ...rest } = new C12(); log(12, a, JSON.stringify(rest)); }
class C13 { constructor() { this.a = 1; this.hidden = "h"; } } { const k = ["hid", "den"].join(""); log(13, new C13()[k], k in new C13(), new C13().hasOwnProperty(k), Object.hasOwn(new C13(), k), Reflect.get(new C13(), k), Reflect.has(new C13(), k)); }
class C14 { constructor() { this.a = 1; this.hidden = "h"; } } log(14, new Map(Object.entries(new C14())).get("hidden"), JSON.stringify(new C14(), ["hidden"]), JSON.stringify([new C14()], (k, v) => k === "a" ? undefined : v));
class C15 { constructor() { this.a = 1; this.hidden = "h"; } } { const o = new C15(); with15(o); function with15(x) { log(15, Object.getOwnPropertyNames(x).length, Object.isFrozen(Object.freeze(x)), Object.getOwnPropertyDescriptor(x, "hidden").writable); } }
const l16 = { a: 1, hidden: { deep: [1, { x: 2 }] } }; log(16, JSON.stringify(l16));
const l17 = { a: 1, hidden: 2 }; log(17, Object.keys(l17).length, l17.a);
function mk18(i) { return { i, unused: i * 2, s: "s" + i }; } log(18, JSON.stringify([1, 2].map(mk18)), mk18(3).i);
class C19 { #p = 1; q = 2; unused = 3; static has(o) { return #p in o; } } log(19, C19.has(new C19()), C19.has({}), JSON.stringify(new C19()));
class C20 { constructor() { this.a = 1; this.b = 2; this.c = 3; } } { const o = new C20(); delete o.b; o.b = 9; log(20, Object.keys(o).join(), JSON.stringify(o)); }
class C21 { constructor(f) { if (f) { this.x = 1; this.y = 2; } else { this.y = 2; this.x = 1; } } } log(21, Object.keys(new C21(true)).join(), Object.keys(new C21(false)).join());
class C22 { constructor() { this.b = 1; this[1] = "one"; this.a = 2; this[0] = "zero"; } } log(22, Object.keys(new C22()).join(), JSON.stringify(new C22()));
class C23 { constructor() { this.a = undefined; this.b = null; this.f = () => 1; this.s = Symbol("s"); } } log(23, Object.keys(new C23()).join(), JSON.stringify(new C23()));
class C24 { constructor() { this.a = 1; Object.defineProperty(this, "n", { value: 2, enumerable: false }); this.c = 3; } } log(24, Object.keys(new C24()).join(), new C24().n, JSON.stringify(new C24()), Object.getOwnPropertyNames(new C24()).join());
const e25 = new (class E extends Error { constructor() { super("m"); this.code = 5; this.extra = "x"; } })(); log(25, Object.keys(e25).join(), JSON.stringify(e25), util.inspect(e25).includes("extra"));
class C26 { constructor() { this.a = 1; this.hidden = "h"; } } { const ch = new MessageChannel(); ch.port2.onmessage = e => { log(26, JSON.stringify(e.data)); ch.port1.close(); }; ch.port1.postMessage(new C26()); }
class C27 { constructor() { this.a = 1; this.hidden = "h"; } } log(27, new URLSearchParams(new C27()).toString(), JSON.stringify(Object.fromEntries(new Headers(new C27()))));
class C28 { constructor() { this.a = 1; this.hidden = "h"; } } log(28, JSON.stringify(Object.groupBy([new C28()], o => "g")), Array.from([new C28()], o => Object.keys(o).length).join());
class C29 { constructor() { this.a = 1; this.hidden = "h"; } } console.table([new C29()]);
class C30 { constructor() { this.a = 1; this.hidden = "h"; } } log(30, util.format("%j %o", new C30(), new C30()));
