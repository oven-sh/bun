const { fullGC } = require("bun:jsc");
globalThis.collect = () => void fullGC();
globalThis.CompiledTarget = class { constructor() { this.a = 1; this.deep = 2; } set c(v) { this.hidden = v; } };
const text = `
const lines = [];
const show = o => { try { return typeof o === "object" && o ? Object.keys(o).map(k => k + "=" + (typeof o[k] === "function" ? "F" : String(o[k]))).join() + (Array.isArray(o) ? "#" + o.length : "") : String(o); } catch (e) { return e.name; } };
const attempt = f => { try { lines.push(show(f())); } catch (e) { lines.push(e.name); } };
const proto = { get b() { return "proto b"; }, set c(v) { lines.push("set c " + v); }, d: "proto d" };
Object.defineProperty(proto, "e", { value: "fixed", writable: false, configurable: true });
const sources = [{}, { a: 1 }, { a: 1, b: 2, c: 3 }, { d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11 }, { 0: "zero", 1: "one", a: 2 }, [1, 2, 3], "text", Object.create({ a: "inherited", z: 1 }, { own: { value: 1, enumerable: true } }), new CompiledTarget(), Object.assign(function () {}, { a: 1, f: 2 }), new Proxy({ a: 1, p: 2 }, {}), { __proto__: null, a: 1, deep: 2 }, (() => { const o = {}; for (let i = 0; i < 90; i++) o["n" + i] = i; return o; })()];
const targets = [() => ({}), () => ({ a: 0 }), () => Object.create(proto), () => Object.freeze({ a: 0 }), () => Object.seal({ a: 0, b: 1 }), () => Object.preventExtensions({ a: 0 }), () => [], () => new CompiledTarget(), () => new Proxy({}, { set(t, k, v) { lines.push("trap " + k); t[k] = v; return true; } }), () => Object.defineProperty({}, "a", { value: "read only", configurable: true }), () => Object.defineProperty({ z: 1 }, "b", { set(v) { this.sb = v; }, configurable: true, enumerable: true }), () => function () {}, () => Object.create(null), () => { const o = { x: 1, y: 2 }; delete o.x; return o; }, () => { const o = {}; Object.create(o); return o; }, () => new (class { a = 1; #p = 2; set f(v) { this.sf = v; } })(), () => new Uint8Array(3)];
const copies = [(t, s) => { for (const k in s) t[k] = s[k]; return t; }, (t, s) => { "use strict"; for (const k in s) t[k] = s[k]; return t; }, (t, s) => { for (const k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = k; return t; }, (t, s) => { for (const k in s) { t[k] = 1; t[k] = s[k]; } return t; }, (t, s) => { for (const k in s) { s[k] = t; delete s[k]; } return t; }];
const round = () => { for (const copy of copies.slice(0, 4)) for (const make of targets) for (const s of sources) attempt(() => copy(make(), s)); };
for (let t = 0; t < 4; t++) round();
for (const change of [() => { proto.f = "now above"; }, () => { Object.defineProperty(proto, "g", { set(v) { lines.push("set g"); }, configurable: true }); }, () => { Object.defineProperty(proto, "d", { value: 1, writable: false, configurable: true }); }, collect, () => { Object.setPrototypeOf(proto, new Proxy({}, { set(t, k) { lines.push("above " + String(k)); return true; } })); }, () => { Object.freeze(proto); }]) { attempt(() => { change(); return "changed"; }); round(); }
// An object that is stored to while its own names are enumerated.
for (let t = 0; t < 20; t++) { const o = { a: 1, b: 2, c: 3 }; for (const k in o) { o[k] = t; if (t % 4 === 1) o["new" + t] = 1; if (t % 4 === 2) delete o.c; } lines.push(show(o)); }
for (let t = 0; t < 6; t++) for (const s of [{ a: 1, b: 2 }, { q: 1 }]) attempt(() => copies[4]({}, { ...s }));
lines.length + " " + lines.reduce((h, l) => { for (let k = 0; k < l.length; k++) h = (Math.imul(h, 31) + l.charCodeAt(k)) | 0; return h; }, 0) + "\\n" + lines.slice(0, 2500).join("\\n");
`;
for (let t = 0; t < 2; t++) console.log((0, eval)("{" + text + "}"));
