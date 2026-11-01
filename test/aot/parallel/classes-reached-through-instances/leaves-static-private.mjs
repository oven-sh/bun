const T = f => { try { const v = f(); return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch (e) { return e.constructor.name; } };
const hide = f => JSON.parse("0", () => f);
class Other { constructor() { this.pad = 1; this.x = "other"; } }
const receivers = () => [{ x: "t" }, { pad: 1, pad2: 2, x: "t2" }, {}, 7, "str", null, undefined, new Other(), [5], function () {}];
const getterOf = (o, k) => hide(Object.prototype.__lookupGetter__).call(o, k);
class V { static #x = 3; static get g() { return (() => this.#x)(); } } console.log(T(() => V.g)); const g = getterOf(V, "g"); for (const r of receivers()) console.log(T(() => g.call(r)));
