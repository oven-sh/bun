const T = f => { try { const v = f(); return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch (e) { return e.constructor.name; } };
const hide = f => JSON.parse("0", () => f);
class Other { constructor() { this.pad = 1; this.x = "other"; } }
const receivers = () => [{ x: "t" }, { pad: 1, pad2: 2, x: "t2" }, {}, 7, "str", null, undefined, new Other(), [5], function () {}];
const getterOf = (o, k) => hide(Object.prototype.__lookupGetter__).call(o, k);
class V { constructor() { this.a = 1; this.x = 3; } get g() { return (() => (() => this.x)())(); } } const v = new V(); console.log(T(() => v.g)); const g = getterOf(v, "g"); for (const r of receivers()) console.log(T(() => g.call(r)));
