// STATISTIC: KnownHelperCalls >= 5
// What copies, compares and prints objects does not see the state that collections of the program hold.
function _checkPrivateRedeclaration(e, t) { if (t.has(e)) throw new TypeError("Cannot initialize the same private elements twice on an object"); }
function _classPrivateFieldInitSpec(e, t, a) { _checkPrivateRedeclaration(e, t), t.set(e, a); }
function _assertClassBrand(e, t, n) { if ("function" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n; throw new TypeError("Private element is not present on this object"); }
function _classPrivateFieldGet2(s, a) { return s.get(_assertClassBrand(s, a)); }
var _x = new WeakMap(), _y = new WeakMap();
class K { constructor(x) { _classPrivateFieldInitSpec(this, _x, x); this.open = 1; } static x(o) { return _classPrivateFieldGet2(_x, o); } }
function F(y) { _classPrivateFieldInitSpec(this, _y, y); this.open = 1; }
F.prototype.y = function () { return _classPrivateFieldGet2(_y, this); };
function attempt(f) { try { console.log(String(f())); } catch (e) { console.log(e.name + ": " + e.message); } }
const util = require("util"), assert = require("assert");
for (const [make, read] of [[v => new K(v), K.x], [v => new F(v), o => F.prototype.y.call(o)], [v => { const o = { open: 1 }; _classPrivateFieldInitSpec(o, _x, v); return o; }, K.x]]) {
  const a = make(1), b = make(2), c = make({ deep: [1, 2] });
  attempt(() => Bun.deepEquals(a, b) + " " + Bun.deepEquals(a, c, true));
  attempt(() => assert.deepStrictEqual(a, b));
  attempt(() => util.isDeepStrictEqual(a, c));
  attempt(() => util.inspect(a, { showHidden: true }) + util.inspect(c));
  attempt(() => JSON.stringify([a, c]) + JSON.stringify(Object.getOwnPropertyDescriptors(c)));
  attempt(() => Object.entries(c).join() + Reflect.ownKeys(c).length + Object.getOwnPropertySymbols(c).length);
  const copies = [{ ...a }, Object.assign({}, a), structuredClone(a), JSON.parse(JSON.stringify(a)), Object.create(a), Object.fromEntries(Object.entries(a))];
  for (const copy of copies) attempt(() => Object.keys(copy).join() + read(copy));
  let names = []; for (const name in c) names.push(name);
  attempt(() => names.join() + (Object.isFrozen(Object.freeze(c)) && read(c).deep));
  attempt(() => { delete a.open; return Object.keys(a).length + " " + read(a); });
  attempt(() => { Object.setPrototypeOf(b, null); b.more = 1; return Object.keys(b).join() + read(b); });
  attempt(() => { const many = make(5); for (let i = 0; i < 80; i++) many["p" + i] = i; for (let i = 0; i < 70; i++) delete many["p" + i]; return Object.keys(many).length + " " + read(many); });
}
attempt(() => { const seen = new Set([new K(1), new K(1)]); return seen.size; });
