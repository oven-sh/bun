// Objects of a proven layout lose their shape in every way the language has.
class P { constructor() { this.x = 1; this.y = 2; this.z = 3; } sum() { return this.x + this.y + this.z; } }
const t = (name, f) => { const p = new P(); let r; try { r = f(p); } catch (e) { r = e.name; } console.log(name, r, String(p.sum()), Object.keys(p).join(), JSON.stringify(Object.getOwnPropertyDescriptor(p, "y") || null)); };
t("delete", p => delete p.y); t("delete add", p => { delete p.x; p.x = 9; });
t("accessor", p => { Object.defineProperty(p, "y", { get() { return 20; }, configurable: true, enumerable: true }); });
t("setter only", p => { Object.defineProperty(p, "y", { set(v) { this.x = v; }, configurable: true }); p.y = 50; });
t("non writable", p => { Object.defineProperty(p, "y", { writable: false }); p.y = 50; });
t("non enumerable", p => { Object.defineProperty(p, "y", { enumerable: false }); });
t("freeze", p => { Object.freeze(p); p.y = 50; p.w = 1; delete p.x; return Object.isFrozen(p); });
t("seal", p => { Object.seal(p); p.y = 50; p.w = 1; delete p.x; return Object.isSealed(p); });
t("prevent", p => { Object.preventExtensions(p); p.w = 1; p.y = 5; return Object.isExtensible(p); });
t("strict frozen", p => { "use strict"; Object.freeze(p); p.y = 50; });
t("many", p => { for (let i = 0; i < 300; i++) p["k" + i] = i; for (let i = 0; i < 300; i++) delete p["k" + i]; });
t("index", p => { p[0] = "i"; p[1000000] = "j"; return p[0] + p[1000000]; });
t("symbol", p => { const s = Symbol(); p[s] = 1; return Object.getOwnPropertySymbols(p).length; });
t("define props", p => { Object.defineProperties(p, { x: { value: "dx" }, q: { value: 1, enumerable: true } }); });
t("reflect define", p => Reflect.defineProperty(p, "z", { value: "rz" }));
t("reflect delete", p => Reflect.deleteProperty(p, "z"));
t("legacy getter", p => { p.__defineGetter__("y", () => 7); });
t("assign", p => { Object.assign(p, { y: "ay", n: 1 }); });
t("proto accessor", p => { Object.defineProperty(P.prototype, "late", { set(v) { this.x = v; }, configurable: true }); p.late = 77; delete P.prototype.late; });
t("proto shadows", p => { delete p.y; P.prototype.y = 1000; const r = p.sum(); delete P.prototype.y; return r; });
t("proto readonly", p => { Object.defineProperty(P.prototype, "w", { value: 1, writable: false, configurable: true }); p.w = 2; const r = p.w; delete P.prototype.w; return r; });
t("structured", p => JSON.stringify(structuredClone(p)));
t("entries", p => Object.entries(p).map(e => e.join("=")).join());
t("spread", p => { const q = { ...p, y: undefined }; return q.x + q.y; });
t("with proxy", p => { const q = new Proxy(p, { set(o, k, v) { o[k] = v + 1; return true; } }); q.y = 1; return q.sum(); });
t("swap values", p => { [p.x, p.y] = [p.y + "", p.x]; });
t("nan", p => { p.x = NaN; p.y = -0; p.z = undefined; return Object.is(p.y, -0); });
