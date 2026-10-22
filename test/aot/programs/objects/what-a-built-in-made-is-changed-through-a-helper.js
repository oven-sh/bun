// Every built-in that hands out a fresh object or array x every change of it (an accessor, a store, a delete, a level of integrity, a symbol, an index, another prototype, a private name), made through a helper,
// then read where it was born. Each case has its own birth, helper and reads. With a number as its argument the program runs that case alone.
function show(v) {
  let t = typeof v;
  try { t += "|" + Reflect.ownKeys(v).map(String).join(); } catch (e) { t += "|" + e.name; }
  try { t += "|" + (Object.getPrototypeOf(v) === null ? "null" : typeof Object.getPrototypeOf(v)); } catch (e) { t += "|" + e.name; }
  try { t += "|" + Object.isFrozen(v) + Object.isExtensible(v); } catch (e) { t += "|" + e.name; }
  return t;
}
function hc0(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c0() { const o = Object.fromEntries([]); const said = hc0(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1() { const o = Object.fromEntries([]); const said = hc1(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc2(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c2() { const o = Object.fromEntries([]); const said = hc2(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc3(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c3() { const o = Object.fromEntries([]); const said = hc3(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc4(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c4() { const o = Object.fromEntries([]); const said = hc4(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc5(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c5() { const o = Object.fromEntries([]); const said = hc5(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc6(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c6() { const o = Object.fromEntries([]); const said = hc6(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc7(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c7() { const o = Object.fromEntries([]); const said = hc7(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc8(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c8() { const o = Object.fromEntries([]); const said = hc8(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc9(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c9() { const o = Object.fromEntries([]); const said = hc9(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc10(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c10() { const o = Object.fromEntries([]); const said = hc10(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc11(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c11() { const o = Object.fromEntries([]); const said = hc11(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc12(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c12() { const o = Object.fromEntries([]); const said = hc12(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc13(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c13() { const o = Object.fromEntries([]); const said = hc13(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc14(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c14() { const o = Object.fromEntries([]); const said = hc14(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc15(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c15() { const o = Object.fromEntries([]); const said = hc15(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc16(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c16() { const o = Object.fromEntries([]); const said = hc16(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc17(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c17() { const o = Object.fromEntries([]); const said = hc17(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c18() { const o = Object.fromEntries([]); const said = hc18(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc19(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c19() { const o = Object.fromEntries([]); const said = hc19(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc20(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c20() { const o = Object.fromEntries([]); const said = hc20(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc21(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c21() { const o = Object.fromEntries([]); const said = hc21(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc22(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c22() { const o = Object.fromEntries([]); const said = hc22(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc23(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c23() { const o = Object.fromEntries([]); const said = hc23(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc24 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc24(X) { try { new Sc24(X); } catch (e) { return e.name; } return "changed"; }
function c24() { const o = Object.fromEntries([]); const said = hc24(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc24.has(o) + Sc24.read(o); }
function hc25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c25() { const o = Object.fromEntries([["a", 1]]); const said = hc25(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c26() { const o = Object.fromEntries([["a", 1]]); const said = hc26(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc27(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c27() { const o = Object.fromEntries([["a", 1]]); const said = hc27(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c28() { const o = Object.fromEntries([["a", 1]]); const said = hc28(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc29(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c29() { const o = Object.fromEntries([["a", 1]]); const said = hc29(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c30() { const o = Object.fromEntries([["a", 1]]); const said = hc30(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c31() { const o = Object.fromEntries([["a", 1]]); const said = hc31(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc32(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c32() { const o = Object.fromEntries([["a", 1]]); const said = hc32(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc33(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c33() { const o = Object.fromEntries([["a", 1]]); const said = hc33(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc34(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c34() { const o = Object.fromEntries([["a", 1]]); const said = hc34(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc35(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c35() { const o = Object.fromEntries([["a", 1]]); const said = hc35(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc36(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c36() { const o = Object.fromEntries([["a", 1]]); const said = hc36(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc37(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c37() { const o = Object.fromEntries([["a", 1]]); const said = hc37(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc38(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c38() { const o = Object.fromEntries([["a", 1]]); const said = hc38(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc39(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c39() { const o = Object.fromEntries([["a", 1]]); const said = hc39(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc40(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c40() { const o = Object.fromEntries([["a", 1]]); const said = hc40(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc41(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c41() { const o = Object.fromEntries([["a", 1]]); const said = hc41(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc42(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c42() { const o = Object.fromEntries([["a", 1]]); const said = hc42(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c43() { const o = Object.fromEntries([["a", 1]]); const said = hc43(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc44(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c44() { const o = Object.fromEntries([["a", 1]]); const said = hc44(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc45(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c45() { const o = Object.fromEntries([["a", 1]]); const said = hc45(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc46(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c46() { const o = Object.fromEntries([["a", 1]]); const said = hc46(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc47(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c47() { const o = Object.fromEntries([["a", 1]]); const said = hc47(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc48(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c48() { const o = Object.fromEntries([["a", 1]]); const said = hc48(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc49 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc49(X) { try { new Sc49(X); } catch (e) { return e.name; } return "changed"; }
function c49() { const o = Object.fromEntries([["a", 1]]); const said = hc49(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc49.has(o) + Sc49.read(o); }
function hc50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c50() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc50(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c51() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc51(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc52(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c52() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc52(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c53() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc53(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc54(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c54() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc54(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c55() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc55(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c56() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc56(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc57(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c57() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc57(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc58(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c58() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc58(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc59(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c59() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc59(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc60(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c60() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc60(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc61(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c61() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc61(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc62(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c62() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc62(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc63(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c63() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc63(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc64(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c64() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc64(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc65(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c65() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc65(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc66(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c66() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc66(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc67(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c67() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc67(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c68() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc68(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc69(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c69() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc69(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc70(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c70() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc70(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc71(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c71() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc71(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc72(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c72() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc72(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc73(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c73() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc73(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc74 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc74(X) { try { new Sc74(X); } catch (e) { return e.name; } return "changed"; }
function c74() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc74(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc74.has(o) + Sc74.read(o); }
function hc75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c75() { const o = Object.groupBy([], () => "group"); const said = hc75(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c76() { const o = Object.groupBy([], () => "group"); const said = hc76(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc77(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c77() { const o = Object.groupBy([], () => "group"); const said = hc77(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c78() { const o = Object.groupBy([], () => "group"); const said = hc78(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc79(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c79() { const o = Object.groupBy([], () => "group"); const said = hc79(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c80() { const o = Object.groupBy([], () => "group"); const said = hc80(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c81() { const o = Object.groupBy([], () => "group"); const said = hc81(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc82(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c82() { const o = Object.groupBy([], () => "group"); const said = hc82(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc83(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c83() { const o = Object.groupBy([], () => "group"); const said = hc83(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc84(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c84() { const o = Object.groupBy([], () => "group"); const said = hc84(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc85(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c85() { const o = Object.groupBy([], () => "group"); const said = hc85(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc86(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c86() { const o = Object.groupBy([], () => "group"); const said = hc86(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc87(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c87() { const o = Object.groupBy([], () => "group"); const said = hc87(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc88(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c88() { const o = Object.groupBy([], () => "group"); const said = hc88(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc89(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c89() { const o = Object.groupBy([], () => "group"); const said = hc89(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc90(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c90() { const o = Object.groupBy([], () => "group"); const said = hc90(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc91(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c91() { const o = Object.groupBy([], () => "group"); const said = hc91(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc92(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c92() { const o = Object.groupBy([], () => "group"); const said = hc92(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c93() { const o = Object.groupBy([], () => "group"); const said = hc93(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc94(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c94() { const o = Object.groupBy([], () => "group"); const said = hc94(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc95(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c95() { const o = Object.groupBy([], () => "group"); const said = hc95(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc96(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c96() { const o = Object.groupBy([], () => "group"); const said = hc96(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc97(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c97() { const o = Object.groupBy([], () => "group"); const said = hc97(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc98(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c98() { const o = Object.groupBy([], () => "group"); const said = hc98(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc99 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc99(X) { try { new Sc99(X); } catch (e) { return e.name; } return "changed"; }
function c99() { const o = Object.groupBy([], () => "group"); const said = hc99(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc99.has(o) + Sc99.read(o); }
function hc100(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c100() { const o = Object.groupBy([1], () => "group"); const said = hc100(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc101(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c101() { const o = Object.groupBy([1], () => "group"); const said = hc101(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc102(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c102() { const o = Object.groupBy([1], () => "group"); const said = hc102(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc103(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c103() { const o = Object.groupBy([1], () => "group"); const said = hc103(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc104(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c104() { const o = Object.groupBy([1], () => "group"); const said = hc104(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc105(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c105() { const o = Object.groupBy([1], () => "group"); const said = hc105(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc106(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c106() { const o = Object.groupBy([1], () => "group"); const said = hc106(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc107(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c107() { const o = Object.groupBy([1], () => "group"); const said = hc107(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc108(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c108() { const o = Object.groupBy([1], () => "group"); const said = hc108(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc109(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c109() { const o = Object.groupBy([1], () => "group"); const said = hc109(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc110(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c110() { const o = Object.groupBy([1], () => "group"); const said = hc110(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc111(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c111() { const o = Object.groupBy([1], () => "group"); const said = hc111(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc112(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c112() { const o = Object.groupBy([1], () => "group"); const said = hc112(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc113(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c113() { const o = Object.groupBy([1], () => "group"); const said = hc113(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc114(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c114() { const o = Object.groupBy([1], () => "group"); const said = hc114(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc115(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c115() { const o = Object.groupBy([1], () => "group"); const said = hc115(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc116(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c116() { const o = Object.groupBy([1], () => "group"); const said = hc116(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc117(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c117() { const o = Object.groupBy([1], () => "group"); const said = hc117(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc118(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c118() { const o = Object.groupBy([1], () => "group"); const said = hc118(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc119(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c119() { const o = Object.groupBy([1], () => "group"); const said = hc119(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc120(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c120() { const o = Object.groupBy([1], () => "group"); const said = hc120(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc121(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c121() { const o = Object.groupBy([1], () => "group"); const said = hc121(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc122(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c122() { const o = Object.groupBy([1], () => "group"); const said = hc122(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc123(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c123() { const o = Object.groupBy([1], () => "group"); const said = hc123(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc124 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc124(X) { try { new Sc124(X); } catch (e) { return e.name; } return "changed"; }
function c124() { const o = Object.groupBy([1], () => "group"); const said = hc124(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc124.has(o) + Sc124.read(o); }
function hc125(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c125() { const o = Map.groupBy([1], () => "group"); const said = hc125(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc126(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c126() { const o = Map.groupBy([1], () => "group"); const said = hc126(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc127(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c127() { const o = Map.groupBy([1], () => "group"); const said = hc127(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc128(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c128() { const o = Map.groupBy([1], () => "group"); const said = hc128(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc129(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c129() { const o = Map.groupBy([1], () => "group"); const said = hc129(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc130(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c130() { const o = Map.groupBy([1], () => "group"); const said = hc130(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc131(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c131() { const o = Map.groupBy([1], () => "group"); const said = hc131(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc132(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c132() { const o = Map.groupBy([1], () => "group"); const said = hc132(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc133(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c133() { const o = Map.groupBy([1], () => "group"); const said = hc133(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc134(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c134() { const o = Map.groupBy([1], () => "group"); const said = hc134(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc135(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c135() { const o = Map.groupBy([1], () => "group"); const said = hc135(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc136(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c136() { const o = Map.groupBy([1], () => "group"); const said = hc136(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc137(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c137() { const o = Map.groupBy([1], () => "group"); const said = hc137(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc138(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c138() { const o = Map.groupBy([1], () => "group"); const said = hc138(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc139(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c139() { const o = Map.groupBy([1], () => "group"); const said = hc139(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc140(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c140() { const o = Map.groupBy([1], () => "group"); const said = hc140(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc141(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c141() { const o = Map.groupBy([1], () => "group"); const said = hc141(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc142(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c142() { const o = Map.groupBy([1], () => "group"); const said = hc142(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc143(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c143() { const o = Map.groupBy([1], () => "group"); const said = hc143(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc144(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c144() { const o = Map.groupBy([1], () => "group"); const said = hc144(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc145(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c145() { const o = Map.groupBy([1], () => "group"); const said = hc145(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc146(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c146() { const o = Map.groupBy([1], () => "group"); const said = hc146(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc147(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c147() { const o = Map.groupBy([1], () => "group"); const said = hc147(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc148(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c148() { const o = Map.groupBy([1], () => "group"); const said = hc148(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc149 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc149(X) { try { new Sc149(X); } catch (e) { return e.name; } return "changed"; }
function c149() { const o = Map.groupBy([1], () => "group"); const said = hc149(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc149.has(o) + Sc149.read(o); }
function hc150(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c150() { const o = Object.create(null); const said = hc150(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc151(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c151() { const o = Object.create(null); const said = hc151(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc152(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c152() { const o = Object.create(null); const said = hc152(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc153(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c153() { const o = Object.create(null); const said = hc153(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc154(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c154() { const o = Object.create(null); const said = hc154(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc155(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c155() { const o = Object.create(null); const said = hc155(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc156(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c156() { const o = Object.create(null); const said = hc156(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc157(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c157() { const o = Object.create(null); const said = hc157(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc158(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c158() { const o = Object.create(null); const said = hc158(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc159(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c159() { const o = Object.create(null); const said = hc159(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc160(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c160() { const o = Object.create(null); const said = hc160(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc161(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c161() { const o = Object.create(null); const said = hc161(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc162(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c162() { const o = Object.create(null); const said = hc162(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc163(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c163() { const o = Object.create(null); const said = hc163(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc164(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c164() { const o = Object.create(null); const said = hc164(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc165(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c165() { const o = Object.create(null); const said = hc165(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc166(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c166() { const o = Object.create(null); const said = hc166(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc167(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c167() { const o = Object.create(null); const said = hc167(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc168(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c168() { const o = Object.create(null); const said = hc168(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc169(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c169() { const o = Object.create(null); const said = hc169(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc170(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c170() { const o = Object.create(null); const said = hc170(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc171(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c171() { const o = Object.create(null); const said = hc171(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc172(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c172() { const o = Object.create(null); const said = hc172(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc173(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c173() { const o = Object.create(null); const said = hc173(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc174 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc174(X) { try { new Sc174(X); } catch (e) { return e.name; } return "changed"; }
function c174() { const o = Object.create(null); const said = hc174(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc174.has(o) + Sc174.read(o); }
function hc175(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c175() { const o = Object.create({ above: 1 }); const said = hc175(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc176(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c176() { const o = Object.create({ above: 1 }); const said = hc176(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc177(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c177() { const o = Object.create({ above: 1 }); const said = hc177(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc178(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c178() { const o = Object.create({ above: 1 }); const said = hc178(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc179(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c179() { const o = Object.create({ above: 1 }); const said = hc179(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc180(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c180() { const o = Object.create({ above: 1 }); const said = hc180(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc181(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c181() { const o = Object.create({ above: 1 }); const said = hc181(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc182(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c182() { const o = Object.create({ above: 1 }); const said = hc182(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc183(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c183() { const o = Object.create({ above: 1 }); const said = hc183(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc184(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c184() { const o = Object.create({ above: 1 }); const said = hc184(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc185(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c185() { const o = Object.create({ above: 1 }); const said = hc185(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc186(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c186() { const o = Object.create({ above: 1 }); const said = hc186(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc187(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c187() { const o = Object.create({ above: 1 }); const said = hc187(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc188(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c188() { const o = Object.create({ above: 1 }); const said = hc188(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc189(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c189() { const o = Object.create({ above: 1 }); const said = hc189(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc190(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c190() { const o = Object.create({ above: 1 }); const said = hc190(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc191(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c191() { const o = Object.create({ above: 1 }); const said = hc191(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc192(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c192() { const o = Object.create({ above: 1 }); const said = hc192(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc193(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c193() { const o = Object.create({ above: 1 }); const said = hc193(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc194(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c194() { const o = Object.create({ above: 1 }); const said = hc194(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc195(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c195() { const o = Object.create({ above: 1 }); const said = hc195(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc196(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c196() { const o = Object.create({ above: 1 }); const said = hc196(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc197(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c197() { const o = Object.create({ above: 1 }); const said = hc197(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc198(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c198() { const o = Object.create({ above: 1 }); const said = hc198(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc199 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc199(X) { try { new Sc199(X); } catch (e) { return e.name; } return "changed"; }
function c199() { const o = Object.create({ above: 1 }); const said = hc199(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc199.has(o) + Sc199.read(o); }
function hc200(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c200() { const o = Object.create(Object.prototype); const said = hc200(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc201(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c201() { const o = Object.create(Object.prototype); const said = hc201(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc202(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c202() { const o = Object.create(Object.prototype); const said = hc202(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc203(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c203() { const o = Object.create(Object.prototype); const said = hc203(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc204(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c204() { const o = Object.create(Object.prototype); const said = hc204(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc205(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c205() { const o = Object.create(Object.prototype); const said = hc205(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc206(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c206() { const o = Object.create(Object.prototype); const said = hc206(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc207(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c207() { const o = Object.create(Object.prototype); const said = hc207(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc208(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c208() { const o = Object.create(Object.prototype); const said = hc208(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc209(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c209() { const o = Object.create(Object.prototype); const said = hc209(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc210(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c210() { const o = Object.create(Object.prototype); const said = hc210(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc211(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c211() { const o = Object.create(Object.prototype); const said = hc211(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc212(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c212() { const o = Object.create(Object.prototype); const said = hc212(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc213(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c213() { const o = Object.create(Object.prototype); const said = hc213(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc214(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c214() { const o = Object.create(Object.prototype); const said = hc214(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc215(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c215() { const o = Object.create(Object.prototype); const said = hc215(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc216(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c216() { const o = Object.create(Object.prototype); const said = hc216(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc217(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c217() { const o = Object.create(Object.prototype); const said = hc217(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc218(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c218() { const o = Object.create(Object.prototype); const said = hc218(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc219(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c219() { const o = Object.create(Object.prototype); const said = hc219(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc220(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c220() { const o = Object.create(Object.prototype); const said = hc220(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc221(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c221() { const o = Object.create(Object.prototype); const said = hc221(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc222(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c222() { const o = Object.create(Object.prototype); const said = hc222(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc223(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c223() { const o = Object.create(Object.prototype); const said = hc223(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc224 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc224(X) { try { new Sc224(X); } catch (e) { return e.name; } return "changed"; }
function c224() { const o = Object.create(Object.prototype); const said = hc224(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc224.has(o) + Sc224.read(o); }
function hc225(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c225() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc225(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc226(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c226() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc226(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc227(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c227() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc227(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc228(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c228() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc228(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc229(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c229() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc229(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc230(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c230() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc230(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc231(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c231() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc231(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc232(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c232() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc232(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc233(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c233() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc233(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc234(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c234() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc234(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc235(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c235() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc235(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc236(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c236() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc236(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc237(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c237() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc237(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc238(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c238() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc238(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc239(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c239() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc239(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc240(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c240() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc240(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc241(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c241() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc241(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc242(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c242() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc242(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc243(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c243() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc243(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc244(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c244() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc244(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc245(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c245() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc245(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc246(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c246() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc246(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc247(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c247() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc247(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc248(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c248() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc248(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc249 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc249(X) { try { new Sc249(X); } catch (e) { return e.name; } return "changed"; }
function c249() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc249(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc249.has(o) + Sc249.read(o); }
function hc250(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c250() { const o = Object.assign({}, { a: 1 }); const said = hc250(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc251(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c251() { const o = Object.assign({}, { a: 1 }); const said = hc251(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc252(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c252() { const o = Object.assign({}, { a: 1 }); const said = hc252(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc253(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c253() { const o = Object.assign({}, { a: 1 }); const said = hc253(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc254(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c254() { const o = Object.assign({}, { a: 1 }); const said = hc254(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc255(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c255() { const o = Object.assign({}, { a: 1 }); const said = hc255(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc256(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c256() { const o = Object.assign({}, { a: 1 }); const said = hc256(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc257(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c257() { const o = Object.assign({}, { a: 1 }); const said = hc257(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc258(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c258() { const o = Object.assign({}, { a: 1 }); const said = hc258(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc259(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c259() { const o = Object.assign({}, { a: 1 }); const said = hc259(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc260(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c260() { const o = Object.assign({}, { a: 1 }); const said = hc260(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc261(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c261() { const o = Object.assign({}, { a: 1 }); const said = hc261(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc262(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c262() { const o = Object.assign({}, { a: 1 }); const said = hc262(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc263(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c263() { const o = Object.assign({}, { a: 1 }); const said = hc263(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc264(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c264() { const o = Object.assign({}, { a: 1 }); const said = hc264(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc265(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c265() { const o = Object.assign({}, { a: 1 }); const said = hc265(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc266(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c266() { const o = Object.assign({}, { a: 1 }); const said = hc266(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc267(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c267() { const o = Object.assign({}, { a: 1 }); const said = hc267(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc268(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c268() { const o = Object.assign({}, { a: 1 }); const said = hc268(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc269(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c269() { const o = Object.assign({}, { a: 1 }); const said = hc269(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc270(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c270() { const o = Object.assign({}, { a: 1 }); const said = hc270(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc271(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c271() { const o = Object.assign({}, { a: 1 }); const said = hc271(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc272(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c272() { const o = Object.assign({}, { a: 1 }); const said = hc272(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc273(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c273() { const o = Object.assign({}, { a: 1 }); const said = hc273(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc274 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc274(X) { try { new Sc274(X); } catch (e) { return e.name; } return "changed"; }
function c274() { const o = Object.assign({}, { a: 1 }); const said = hc274(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc274.has(o) + Sc274.read(o); }
function hc275(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c275() { const o = structuredClone({ a: 1 }); const said = hc275(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc276(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c276() { const o = structuredClone({ a: 1 }); const said = hc276(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc277(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c277() { const o = structuredClone({ a: 1 }); const said = hc277(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc278(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c278() { const o = structuredClone({ a: 1 }); const said = hc278(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc279(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c279() { const o = structuredClone({ a: 1 }); const said = hc279(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc280(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c280() { const o = structuredClone({ a: 1 }); const said = hc280(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc281(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c281() { const o = structuredClone({ a: 1 }); const said = hc281(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc282(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c282() { const o = structuredClone({ a: 1 }); const said = hc282(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc283(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c283() { const o = structuredClone({ a: 1 }); const said = hc283(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc284(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c284() { const o = structuredClone({ a: 1 }); const said = hc284(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc285(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c285() { const o = structuredClone({ a: 1 }); const said = hc285(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc286(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c286() { const o = structuredClone({ a: 1 }); const said = hc286(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc287(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c287() { const o = structuredClone({ a: 1 }); const said = hc287(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc288(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c288() { const o = structuredClone({ a: 1 }); const said = hc288(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc289(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c289() { const o = structuredClone({ a: 1 }); const said = hc289(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc290(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c290() { const o = structuredClone({ a: 1 }); const said = hc290(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc291(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c291() { const o = structuredClone({ a: 1 }); const said = hc291(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc292(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c292() { const o = structuredClone({ a: 1 }); const said = hc292(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc293(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c293() { const o = structuredClone({ a: 1 }); const said = hc293(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc294(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c294() { const o = structuredClone({ a: 1 }); const said = hc294(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc295(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c295() { const o = structuredClone({ a: 1 }); const said = hc295(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc296(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c296() { const o = structuredClone({ a: 1 }); const said = hc296(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc297(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c297() { const o = structuredClone({ a: 1 }); const said = hc297(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc298(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c298() { const o = structuredClone({ a: 1 }); const said = hc298(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc299 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc299(X) { try { new Sc299(X); } catch (e) { return e.name; } return "changed"; }
function c299() { const o = structuredClone({ a: 1 }); const said = hc299(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc299.has(o) + Sc299.read(o); }
function hc300(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c300() { const o = structuredClone([1]); const said = hc300(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc301(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c301() { const o = structuredClone([1]); const said = hc301(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc302(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c302() { const o = structuredClone([1]); const said = hc302(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc303(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c303() { const o = structuredClone([1]); const said = hc303(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc304(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c304() { const o = structuredClone([1]); const said = hc304(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc305(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c305() { const o = structuredClone([1]); const said = hc305(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc306(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c306() { const o = structuredClone([1]); const said = hc306(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc307(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c307() { const o = structuredClone([1]); const said = hc307(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc308(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c308() { const o = structuredClone([1]); const said = hc308(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc309(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c309() { const o = structuredClone([1]); const said = hc309(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc310(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c310() { const o = structuredClone([1]); const said = hc310(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc311(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c311() { const o = structuredClone([1]); const said = hc311(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc312(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c312() { const o = structuredClone([1]); const said = hc312(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc313(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c313() { const o = structuredClone([1]); const said = hc313(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc314(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c314() { const o = structuredClone([1]); const said = hc314(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc315(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c315() { const o = structuredClone([1]); const said = hc315(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc316(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c316() { const o = structuredClone([1]); const said = hc316(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc317(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c317() { const o = structuredClone([1]); const said = hc317(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc318(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c318() { const o = structuredClone([1]); const said = hc318(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc319(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c319() { const o = structuredClone([1]); const said = hc319(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc320(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c320() { const o = structuredClone([1]); const said = hc320(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc321(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c321() { const o = structuredClone([1]); const said = hc321(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc322(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c322() { const o = structuredClone([1]); const said = hc322(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc323(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c323() { const o = structuredClone([1]); const said = hc323(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc324 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc324(X) { try { new Sc324(X); } catch (e) { return e.name; } return "changed"; }
function c324() { const o = structuredClone([1]); const said = hc324(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc324.has(o) + Sc324.read(o); }
function hc325(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c325() { const o = JSON.parse('{"a":1}'); const said = hc325(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc326(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c326() { const o = JSON.parse('{"a":1}'); const said = hc326(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc327(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c327() { const o = JSON.parse('{"a":1}'); const said = hc327(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc328(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c328() { const o = JSON.parse('{"a":1}'); const said = hc328(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc329(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c329() { const o = JSON.parse('{"a":1}'); const said = hc329(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc330(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c330() { const o = JSON.parse('{"a":1}'); const said = hc330(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc331(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c331() { const o = JSON.parse('{"a":1}'); const said = hc331(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc332(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c332() { const o = JSON.parse('{"a":1}'); const said = hc332(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc333(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c333() { const o = JSON.parse('{"a":1}'); const said = hc333(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc334(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c334() { const o = JSON.parse('{"a":1}'); const said = hc334(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc335(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c335() { const o = JSON.parse('{"a":1}'); const said = hc335(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc336(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c336() { const o = JSON.parse('{"a":1}'); const said = hc336(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc337(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c337() { const o = JSON.parse('{"a":1}'); const said = hc337(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc338(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c338() { const o = JSON.parse('{"a":1}'); const said = hc338(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc339(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c339() { const o = JSON.parse('{"a":1}'); const said = hc339(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc340(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c340() { const o = JSON.parse('{"a":1}'); const said = hc340(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc341(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c341() { const o = JSON.parse('{"a":1}'); const said = hc341(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc342(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c342() { const o = JSON.parse('{"a":1}'); const said = hc342(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc343(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c343() { const o = JSON.parse('{"a":1}'); const said = hc343(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc344(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c344() { const o = JSON.parse('{"a":1}'); const said = hc344(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc345(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c345() { const o = JSON.parse('{"a":1}'); const said = hc345(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc346(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c346() { const o = JSON.parse('{"a":1}'); const said = hc346(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc347(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c347() { const o = JSON.parse('{"a":1}'); const said = hc347(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc348(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c348() { const o = JSON.parse('{"a":1}'); const said = hc348(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc349 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc349(X) { try { new Sc349(X); } catch (e) { return e.name; } return "changed"; }
function c349() { const o = JSON.parse('{"a":1}'); const said = hc349(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc349.has(o) + Sc349.read(o); }
function hc350(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c350() { const o = JSON.parse('[1]'); const said = hc350(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc351(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c351() { const o = JSON.parse('[1]'); const said = hc351(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc352(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c352() { const o = JSON.parse('[1]'); const said = hc352(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc353(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c353() { const o = JSON.parse('[1]'); const said = hc353(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc354(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c354() { const o = JSON.parse('[1]'); const said = hc354(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc355(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c355() { const o = JSON.parse('[1]'); const said = hc355(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc356(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c356() { const o = JSON.parse('[1]'); const said = hc356(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc357(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c357() { const o = JSON.parse('[1]'); const said = hc357(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc358(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c358() { const o = JSON.parse('[1]'); const said = hc358(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc359(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c359() { const o = JSON.parse('[1]'); const said = hc359(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc360(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c360() { const o = JSON.parse('[1]'); const said = hc360(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc361(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c361() { const o = JSON.parse('[1]'); const said = hc361(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc362(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c362() { const o = JSON.parse('[1]'); const said = hc362(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc363(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c363() { const o = JSON.parse('[1]'); const said = hc363(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc364(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c364() { const o = JSON.parse('[1]'); const said = hc364(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc365(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c365() { const o = JSON.parse('[1]'); const said = hc365(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc366(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c366() { const o = JSON.parse('[1]'); const said = hc366(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc367(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c367() { const o = JSON.parse('[1]'); const said = hc367(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc368(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c368() { const o = JSON.parse('[1]'); const said = hc368(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc369(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c369() { const o = JSON.parse('[1]'); const said = hc369(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc370(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c370() { const o = JSON.parse('[1]'); const said = hc370(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc371(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c371() { const o = JSON.parse('[1]'); const said = hc371(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc372(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c372() { const o = JSON.parse('[1]'); const said = hc372(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc373(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c373() { const o = JSON.parse('[1]'); const said = hc373(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc374 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc374(X) { try { new Sc374(X); } catch (e) { return e.name; } return "changed"; }
function c374() { const o = JSON.parse('[1]'); const said = hc374(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc374.has(o) + Sc374.read(o); }
function hc375(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c375() { const o = Array.from([1]); const said = hc375(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc376(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c376() { const o = Array.from([1]); const said = hc376(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc377(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c377() { const o = Array.from([1]); const said = hc377(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc378(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c378() { const o = Array.from([1]); const said = hc378(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc379(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c379() { const o = Array.from([1]); const said = hc379(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc380(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c380() { const o = Array.from([1]); const said = hc380(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc381(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c381() { const o = Array.from([1]); const said = hc381(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc382(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c382() { const o = Array.from([1]); const said = hc382(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc383(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c383() { const o = Array.from([1]); const said = hc383(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc384(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c384() { const o = Array.from([1]); const said = hc384(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc385(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c385() { const o = Array.from([1]); const said = hc385(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc386(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c386() { const o = Array.from([1]); const said = hc386(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc387(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c387() { const o = Array.from([1]); const said = hc387(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc388(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c388() { const o = Array.from([1]); const said = hc388(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc389(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c389() { const o = Array.from([1]); const said = hc389(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc390(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c390() { const o = Array.from([1]); const said = hc390(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc391(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c391() { const o = Array.from([1]); const said = hc391(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc392(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c392() { const o = Array.from([1]); const said = hc392(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc393(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c393() { const o = Array.from([1]); const said = hc393(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc394(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c394() { const o = Array.from([1]); const said = hc394(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc395(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c395() { const o = Array.from([1]); const said = hc395(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc396(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c396() { const o = Array.from([1]); const said = hc396(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc397(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c397() { const o = Array.from([1]); const said = hc397(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc398(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c398() { const o = Array.from([1]); const said = hc398(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc399 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc399(X) { try { new Sc399(X); } catch (e) { return e.name; } return "changed"; }
function c399() { const o = Array.from([1]); const said = hc399(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc399.has(o) + Sc399.read(o); }
function hc400(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c400() { const o = Array.from({ length: 1 }); const said = hc400(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc401(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c401() { const o = Array.from({ length: 1 }); const said = hc401(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc402(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c402() { const o = Array.from({ length: 1 }); const said = hc402(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc403(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c403() { const o = Array.from({ length: 1 }); const said = hc403(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc404(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c404() { const o = Array.from({ length: 1 }); const said = hc404(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc405(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c405() { const o = Array.from({ length: 1 }); const said = hc405(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc406(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c406() { const o = Array.from({ length: 1 }); const said = hc406(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc407(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c407() { const o = Array.from({ length: 1 }); const said = hc407(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc408(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c408() { const o = Array.from({ length: 1 }); const said = hc408(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc409(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c409() { const o = Array.from({ length: 1 }); const said = hc409(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc410(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c410() { const o = Array.from({ length: 1 }); const said = hc410(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc411(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c411() { const o = Array.from({ length: 1 }); const said = hc411(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc412(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c412() { const o = Array.from({ length: 1 }); const said = hc412(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc413(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c413() { const o = Array.from({ length: 1 }); const said = hc413(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc414(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c414() { const o = Array.from({ length: 1 }); const said = hc414(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc415(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c415() { const o = Array.from({ length: 1 }); const said = hc415(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc416(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c416() { const o = Array.from({ length: 1 }); const said = hc416(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc417(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c417() { const o = Array.from({ length: 1 }); const said = hc417(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc418(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c418() { const o = Array.from({ length: 1 }); const said = hc418(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc419(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c419() { const o = Array.from({ length: 1 }); const said = hc419(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc420(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c420() { const o = Array.from({ length: 1 }); const said = hc420(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc421(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c421() { const o = Array.from({ length: 1 }); const said = hc421(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc422(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c422() { const o = Array.from({ length: 1 }); const said = hc422(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc423(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c423() { const o = Array.from({ length: 1 }); const said = hc423(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc424 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc424(X) { try { new Sc424(X); } catch (e) { return e.name; } return "changed"; }
function c424() { const o = Array.from({ length: 1 }); const said = hc424(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc424.has(o) + Sc424.read(o); }
function hc425(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c425() { const o = Array.of(1); const said = hc425(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc426(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c426() { const o = Array.of(1); const said = hc426(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc427(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c427() { const o = Array.of(1); const said = hc427(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc428(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c428() { const o = Array.of(1); const said = hc428(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc429(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c429() { const o = Array.of(1); const said = hc429(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc430(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c430() { const o = Array.of(1); const said = hc430(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc431(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c431() { const o = Array.of(1); const said = hc431(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc432(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c432() { const o = Array.of(1); const said = hc432(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc433(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c433() { const o = Array.of(1); const said = hc433(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc434(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c434() { const o = Array.of(1); const said = hc434(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc435(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c435() { const o = Array.of(1); const said = hc435(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc436(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c436() { const o = Array.of(1); const said = hc436(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc437(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c437() { const o = Array.of(1); const said = hc437(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc438(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c438() { const o = Array.of(1); const said = hc438(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc439(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c439() { const o = Array.of(1); const said = hc439(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc440(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c440() { const o = Array.of(1); const said = hc440(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc441(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c441() { const o = Array.of(1); const said = hc441(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc442(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c442() { const o = Array.of(1); const said = hc442(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc443(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c443() { const o = Array.of(1); const said = hc443(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc444(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c444() { const o = Array.of(1); const said = hc444(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc445(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c445() { const o = Array.of(1); const said = hc445(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc446(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c446() { const o = Array.of(1); const said = hc446(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc447(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c447() { const o = Array.of(1); const said = hc447(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc448(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c448() { const o = Array.of(1); const said = hc448(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc449 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc449(X) { try { new Sc449(X); } catch (e) { return e.name; } return "changed"; }
function c449() { const o = Array.of(1); const said = hc449(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc449.has(o) + Sc449.read(o); }
function hc450(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c450() { const o = new Array(2); const said = hc450(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc451(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c451() { const o = new Array(2); const said = hc451(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc452(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c452() { const o = new Array(2); const said = hc452(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc453(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c453() { const o = new Array(2); const said = hc453(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc454(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c454() { const o = new Array(2); const said = hc454(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc455(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c455() { const o = new Array(2); const said = hc455(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc456(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c456() { const o = new Array(2); const said = hc456(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc457(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c457() { const o = new Array(2); const said = hc457(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc458(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c458() { const o = new Array(2); const said = hc458(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc459(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c459() { const o = new Array(2); const said = hc459(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc460(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c460() { const o = new Array(2); const said = hc460(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc461(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c461() { const o = new Array(2); const said = hc461(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc462(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c462() { const o = new Array(2); const said = hc462(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc463(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c463() { const o = new Array(2); const said = hc463(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc464(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c464() { const o = new Array(2); const said = hc464(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc465(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c465() { const o = new Array(2); const said = hc465(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc466(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c466() { const o = new Array(2); const said = hc466(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc467(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c467() { const o = new Array(2); const said = hc467(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc468(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c468() { const o = new Array(2); const said = hc468(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc469(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c469() { const o = new Array(2); const said = hc469(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc470(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c470() { const o = new Array(2); const said = hc470(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc471(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c471() { const o = new Array(2); const said = hc471(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc472(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c472() { const o = new Array(2); const said = hc472(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc473(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c473() { const o = new Array(2); const said = hc473(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc474 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc474(X) { try { new Sc474(X); } catch (e) { return e.name; } return "changed"; }
function c474() { const o = new Array(2); const said = hc474(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc474.has(o) + Sc474.read(o); }
function hc475(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c475() { const o = Array(1, 2); const said = hc475(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc476(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c476() { const o = Array(1, 2); const said = hc476(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc477(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c477() { const o = Array(1, 2); const said = hc477(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc478(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c478() { const o = Array(1, 2); const said = hc478(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc479(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c479() { const o = Array(1, 2); const said = hc479(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc480(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c480() { const o = Array(1, 2); const said = hc480(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc481(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c481() { const o = Array(1, 2); const said = hc481(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc482(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c482() { const o = Array(1, 2); const said = hc482(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc483(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c483() { const o = Array(1, 2); const said = hc483(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc484(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c484() { const o = Array(1, 2); const said = hc484(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc485(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c485() { const o = Array(1, 2); const said = hc485(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc486(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c486() { const o = Array(1, 2); const said = hc486(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc487(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c487() { const o = Array(1, 2); const said = hc487(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc488(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c488() { const o = Array(1, 2); const said = hc488(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc489(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c489() { const o = Array(1, 2); const said = hc489(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc490(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c490() { const o = Array(1, 2); const said = hc490(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc491(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c491() { const o = Array(1, 2); const said = hc491(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc492(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c492() { const o = Array(1, 2); const said = hc492(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc493(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c493() { const o = Array(1, 2); const said = hc493(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc494(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c494() { const o = Array(1, 2); const said = hc494(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc495(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c495() { const o = Array(1, 2); const said = hc495(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc496(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c496() { const o = Array(1, 2); const said = hc496(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc497(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c497() { const o = Array(1, 2); const said = hc497(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc498(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c498() { const o = Array(1, 2); const said = hc498(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc499 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc499(X) { try { new Sc499(X); } catch (e) { return e.name; } return "changed"; }
function c499() { const o = Array(1, 2); const said = hc499(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc499.has(o) + Sc499.read(o); }
function hc500(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c500() { const o = Object.entries({ a: 1 }); const said = hc500(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc501(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c501() { const o = Object.entries({ a: 1 }); const said = hc501(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc502(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c502() { const o = Object.entries({ a: 1 }); const said = hc502(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc503(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c503() { const o = Object.entries({ a: 1 }); const said = hc503(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc504(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c504() { const o = Object.entries({ a: 1 }); const said = hc504(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc505(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c505() { const o = Object.entries({ a: 1 }); const said = hc505(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc506(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c506() { const o = Object.entries({ a: 1 }); const said = hc506(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc507(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c507() { const o = Object.entries({ a: 1 }); const said = hc507(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc508(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c508() { const o = Object.entries({ a: 1 }); const said = hc508(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc509(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c509() { const o = Object.entries({ a: 1 }); const said = hc509(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc510(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c510() { const o = Object.entries({ a: 1 }); const said = hc510(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc511(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c511() { const o = Object.entries({ a: 1 }); const said = hc511(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc512(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c512() { const o = Object.entries({ a: 1 }); const said = hc512(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc513(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c513() { const o = Object.entries({ a: 1 }); const said = hc513(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc514(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c514() { const o = Object.entries({ a: 1 }); const said = hc514(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc515(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c515() { const o = Object.entries({ a: 1 }); const said = hc515(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc516(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c516() { const o = Object.entries({ a: 1 }); const said = hc516(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc517(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c517() { const o = Object.entries({ a: 1 }); const said = hc517(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc518(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c518() { const o = Object.entries({ a: 1 }); const said = hc518(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc519(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c519() { const o = Object.entries({ a: 1 }); const said = hc519(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc520(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c520() { const o = Object.entries({ a: 1 }); const said = hc520(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc521(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c521() { const o = Object.entries({ a: 1 }); const said = hc521(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc522(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c522() { const o = Object.entries({ a: 1 }); const said = hc522(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc523(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c523() { const o = Object.entries({ a: 1 }); const said = hc523(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc524 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc524(X) { try { new Sc524(X); } catch (e) { return e.name; } return "changed"; }
function c524() { const o = Object.entries({ a: 1 }); const said = hc524(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc524.has(o) + Sc524.read(o); }
function hc525(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c525() { const o = Object.entries({ a: 1 })[0]; const said = hc525(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc526(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c526() { const o = Object.entries({ a: 1 })[0]; const said = hc526(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc527(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c527() { const o = Object.entries({ a: 1 })[0]; const said = hc527(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc528(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c528() { const o = Object.entries({ a: 1 })[0]; const said = hc528(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc529(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c529() { const o = Object.entries({ a: 1 })[0]; const said = hc529(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc530(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c530() { const o = Object.entries({ a: 1 })[0]; const said = hc530(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc531(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c531() { const o = Object.entries({ a: 1 })[0]; const said = hc531(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc532(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c532() { const o = Object.entries({ a: 1 })[0]; const said = hc532(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc533(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c533() { const o = Object.entries({ a: 1 })[0]; const said = hc533(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc534(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c534() { const o = Object.entries({ a: 1 })[0]; const said = hc534(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc535(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c535() { const o = Object.entries({ a: 1 })[0]; const said = hc535(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc536(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c536() { const o = Object.entries({ a: 1 })[0]; const said = hc536(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc537(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c537() { const o = Object.entries({ a: 1 })[0]; const said = hc537(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc538(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c538() { const o = Object.entries({ a: 1 })[0]; const said = hc538(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc539(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c539() { const o = Object.entries({ a: 1 })[0]; const said = hc539(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc540(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c540() { const o = Object.entries({ a: 1 })[0]; const said = hc540(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc541(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c541() { const o = Object.entries({ a: 1 })[0]; const said = hc541(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc542(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c542() { const o = Object.entries({ a: 1 })[0]; const said = hc542(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc543(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c543() { const o = Object.entries({ a: 1 })[0]; const said = hc543(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc544(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c544() { const o = Object.entries({ a: 1 })[0]; const said = hc544(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc545(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c545() { const o = Object.entries({ a: 1 })[0]; const said = hc545(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc546(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c546() { const o = Object.entries({ a: 1 })[0]; const said = hc546(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc547(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c547() { const o = Object.entries({ a: 1 })[0]; const said = hc547(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc548(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c548() { const o = Object.entries({ a: 1 })[0]; const said = hc548(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc549 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc549(X) { try { new Sc549(X); } catch (e) { return e.name; } return "changed"; }
function c549() { const o = Object.entries({ a: 1 })[0]; const said = hc549(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc549.has(o) + Sc549.read(o); }
function hc550(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c550() { const o = Object.values({ a: 1 }); const said = hc550(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc551(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c551() { const o = Object.values({ a: 1 }); const said = hc551(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc552(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c552() { const o = Object.values({ a: 1 }); const said = hc552(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc553(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c553() { const o = Object.values({ a: 1 }); const said = hc553(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc554(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c554() { const o = Object.values({ a: 1 }); const said = hc554(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc555(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c555() { const o = Object.values({ a: 1 }); const said = hc555(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc556(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c556() { const o = Object.values({ a: 1 }); const said = hc556(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc557(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c557() { const o = Object.values({ a: 1 }); const said = hc557(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc558(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c558() { const o = Object.values({ a: 1 }); const said = hc558(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc559(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c559() { const o = Object.values({ a: 1 }); const said = hc559(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc560(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c560() { const o = Object.values({ a: 1 }); const said = hc560(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc561(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c561() { const o = Object.values({ a: 1 }); const said = hc561(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc562(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c562() { const o = Object.values({ a: 1 }); const said = hc562(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc563(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c563() { const o = Object.values({ a: 1 }); const said = hc563(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc564(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c564() { const o = Object.values({ a: 1 }); const said = hc564(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc565(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c565() { const o = Object.values({ a: 1 }); const said = hc565(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc566(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c566() { const o = Object.values({ a: 1 }); const said = hc566(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc567(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c567() { const o = Object.values({ a: 1 }); const said = hc567(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc568(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c568() { const o = Object.values({ a: 1 }); const said = hc568(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc569(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c569() { const o = Object.values({ a: 1 }); const said = hc569(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc570(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c570() { const o = Object.values({ a: 1 }); const said = hc570(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc571(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c571() { const o = Object.values({ a: 1 }); const said = hc571(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc572(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c572() { const o = Object.values({ a: 1 }); const said = hc572(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc573(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c573() { const o = Object.values({ a: 1 }); const said = hc573(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc574 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc574(X) { try { new Sc574(X); } catch (e) { return e.name; } return "changed"; }
function c574() { const o = Object.values({ a: 1 }); const said = hc574(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc574.has(o) + Sc574.read(o); }
function hc575(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c575() { const o = Object.keys({ a: 1 }); const said = hc575(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc576(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c576() { const o = Object.keys({ a: 1 }); const said = hc576(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc577(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c577() { const o = Object.keys({ a: 1 }); const said = hc577(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc578(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c578() { const o = Object.keys({ a: 1 }); const said = hc578(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc579(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c579() { const o = Object.keys({ a: 1 }); const said = hc579(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc580(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c580() { const o = Object.keys({ a: 1 }); const said = hc580(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc581(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c581() { const o = Object.keys({ a: 1 }); const said = hc581(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc582(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c582() { const o = Object.keys({ a: 1 }); const said = hc582(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc583(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c583() { const o = Object.keys({ a: 1 }); const said = hc583(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc584(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c584() { const o = Object.keys({ a: 1 }); const said = hc584(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc585(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c585() { const o = Object.keys({ a: 1 }); const said = hc585(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc586(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c586() { const o = Object.keys({ a: 1 }); const said = hc586(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc587(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c587() { const o = Object.keys({ a: 1 }); const said = hc587(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc588(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c588() { const o = Object.keys({ a: 1 }); const said = hc588(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc589(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c589() { const o = Object.keys({ a: 1 }); const said = hc589(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc590(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c590() { const o = Object.keys({ a: 1 }); const said = hc590(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc591(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c591() { const o = Object.keys({ a: 1 }); const said = hc591(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc592(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c592() { const o = Object.keys({ a: 1 }); const said = hc592(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc593(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c593() { const o = Object.keys({ a: 1 }); const said = hc593(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc594(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c594() { const o = Object.keys({ a: 1 }); const said = hc594(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc595(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c595() { const o = Object.keys({ a: 1 }); const said = hc595(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc596(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c596() { const o = Object.keys({ a: 1 }); const said = hc596(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc597(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c597() { const o = Object.keys({ a: 1 }); const said = hc597(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc598(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c598() { const o = Object.keys({ a: 1 }); const said = hc598(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc599 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc599(X) { try { new Sc599(X); } catch (e) { return e.name; } return "changed"; }
function c599() { const o = Object.keys({ a: 1 }); const said = hc599(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc599.has(o) + Sc599.read(o); }
function hc600(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c600() { const o = Reflect.ownKeys({ a: 1 }); const said = hc600(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc601(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c601() { const o = Reflect.ownKeys({ a: 1 }); const said = hc601(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc602(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c602() { const o = Reflect.ownKeys({ a: 1 }); const said = hc602(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc603(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c603() { const o = Reflect.ownKeys({ a: 1 }); const said = hc603(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc604(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c604() { const o = Reflect.ownKeys({ a: 1 }); const said = hc604(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc605(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c605() { const o = Reflect.ownKeys({ a: 1 }); const said = hc605(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc606(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c606() { const o = Reflect.ownKeys({ a: 1 }); const said = hc606(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc607(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c607() { const o = Reflect.ownKeys({ a: 1 }); const said = hc607(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc608(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c608() { const o = Reflect.ownKeys({ a: 1 }); const said = hc608(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc609(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c609() { const o = Reflect.ownKeys({ a: 1 }); const said = hc609(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc610(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c610() { const o = Reflect.ownKeys({ a: 1 }); const said = hc610(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc611(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c611() { const o = Reflect.ownKeys({ a: 1 }); const said = hc611(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc612(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c612() { const o = Reflect.ownKeys({ a: 1 }); const said = hc612(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc613(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c613() { const o = Reflect.ownKeys({ a: 1 }); const said = hc613(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc614(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c614() { const o = Reflect.ownKeys({ a: 1 }); const said = hc614(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc615(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c615() { const o = Reflect.ownKeys({ a: 1 }); const said = hc615(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc616(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c616() { const o = Reflect.ownKeys({ a: 1 }); const said = hc616(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc617(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c617() { const o = Reflect.ownKeys({ a: 1 }); const said = hc617(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc618(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c618() { const o = Reflect.ownKeys({ a: 1 }); const said = hc618(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc619(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c619() { const o = Reflect.ownKeys({ a: 1 }); const said = hc619(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc620(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c620() { const o = Reflect.ownKeys({ a: 1 }); const said = hc620(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc621(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c621() { const o = Reflect.ownKeys({ a: 1 }); const said = hc621(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc622(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c622() { const o = Reflect.ownKeys({ a: 1 }); const said = hc622(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc623(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c623() { const o = Reflect.ownKeys({ a: 1 }); const said = hc623(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc624 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc624(X) { try { new Sc624(X); } catch (e) { return e.name; } return "changed"; }
function c624() { const o = Reflect.ownKeys({ a: 1 }); const said = hc624(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc624.has(o) + Sc624.read(o); }
function hc625(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c625() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc625(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc626(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c626() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc626(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc627(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c627() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc627(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc628(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c628() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc628(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc629(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c629() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc629(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc630(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c630() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc630(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc631(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c631() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc631(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc632(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c632() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc632(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc633(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c633() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc633(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc634(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c634() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc634(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc635(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c635() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc635(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc636(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c636() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc636(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc637(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c637() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc637(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc638(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c638() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc638(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc639(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c639() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc639(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc640(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c640() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc640(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc641(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c641() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc641(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc642(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c642() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc642(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc643(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c643() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc643(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc644(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c644() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc644(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc645(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c645() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc645(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc646(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c646() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc646(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc647(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c647() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc647(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc648(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c648() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc648(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc649 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc649(X) { try { new Sc649(X); } catch (e) { return e.name; } return "changed"; }
function c649() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc649(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc649.has(o) + Sc649.read(o); }
function hc650(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c650() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc650(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc651(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c651() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc651(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc652(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c652() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc652(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc653(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c653() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc653(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc654(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c654() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc654(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc655(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c655() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc655(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc656(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c656() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc656(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc657(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c657() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc657(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc658(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c658() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc658(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc659(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c659() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc659(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc660(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c660() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc660(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc661(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c661() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc661(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc662(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c662() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc662(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc663(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c663() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc663(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc664(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c664() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc664(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc665(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c665() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc665(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc666(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c666() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc666(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc667(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c667() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc667(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc668(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c668() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc668(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc669(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c669() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc669(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc670(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c670() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc670(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc671(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c671() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc671(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc672(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c672() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc672(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc673(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c673() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc673(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc674 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc674(X) { try { new Sc674(X); } catch (e) { return e.name; } return "changed"; }
function c674() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc674(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc674.has(o) + Sc674.read(o); }
function hc675(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c675() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc675(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc676(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c676() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc676(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc677(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c677() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc677(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc678(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c678() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc678(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc679(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c679() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc679(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc680(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c680() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc680(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc681(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c681() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc681(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc682(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c682() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc682(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc683(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c683() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc683(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc684(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c684() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc684(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc685(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c685() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc685(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc686(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c686() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc686(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc687(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c687() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc687(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc688(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c688() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc688(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc689(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c689() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc689(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc690(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c690() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc690(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc691(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c691() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc691(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc692(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c692() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc692(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc693(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c693() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc693(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc694(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c694() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc694(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc695(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c695() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc695(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc696(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c696() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc696(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc697(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c697() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc697(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc698(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c698() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc698(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc699 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc699(X) { try { new Sc699(X); } catch (e) { return e.name; } return "changed"; }
function c699() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc699(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc699.has(o) + Sc699.read(o); }
function hc700(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c700() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc700(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc701(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c701() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc701(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc702(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c702() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc702(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc703(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c703() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc703(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc704(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c704() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc704(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc705(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c705() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc705(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc706(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c706() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc706(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc707(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c707() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc707(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc708(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c708() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc708(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc709(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c709() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc709(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc710(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c710() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc710(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc711(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c711() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc711(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc712(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c712() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc712(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc713(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c713() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc713(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc714(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c714() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc714(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc715(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c715() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc715(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc716(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c716() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc716(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc717(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c717() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc717(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc718(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c718() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc718(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc719(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c719() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc719(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc720(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c720() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc720(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc721(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c721() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc721(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc722(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c722() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc722(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc723(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c723() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc723(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc724 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc724(X) { try { new Sc724(X); } catch (e) { return e.name; } return "changed"; }
function c724() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc724(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc724.has(o) + Sc724.read(o); }
function hc725(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c725() { const o = [1].values().next(); const said = hc725(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc726(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c726() { const o = [1].values().next(); const said = hc726(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc727(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c727() { const o = [1].values().next(); const said = hc727(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc728(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c728() { const o = [1].values().next(); const said = hc728(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc729(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c729() { const o = [1].values().next(); const said = hc729(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc730(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c730() { const o = [1].values().next(); const said = hc730(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc731(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c731() { const o = [1].values().next(); const said = hc731(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc732(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c732() { const o = [1].values().next(); const said = hc732(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc733(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c733() { const o = [1].values().next(); const said = hc733(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc734(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c734() { const o = [1].values().next(); const said = hc734(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc735(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c735() { const o = [1].values().next(); const said = hc735(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc736(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c736() { const o = [1].values().next(); const said = hc736(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc737(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c737() { const o = [1].values().next(); const said = hc737(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc738(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c738() { const o = [1].values().next(); const said = hc738(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc739(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c739() { const o = [1].values().next(); const said = hc739(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc740(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c740() { const o = [1].values().next(); const said = hc740(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc741(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c741() { const o = [1].values().next(); const said = hc741(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc742(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c742() { const o = [1].values().next(); const said = hc742(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc743(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c743() { const o = [1].values().next(); const said = hc743(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc744(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c744() { const o = [1].values().next(); const said = hc744(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc745(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c745() { const o = [1].values().next(); const said = hc745(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc746(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c746() { const o = [1].values().next(); const said = hc746(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc747(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c747() { const o = [1].values().next(); const said = hc747(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc748(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c748() { const o = [1].values().next(); const said = hc748(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc749 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc749(X) { try { new Sc749(X); } catch (e) { return e.name; } return "changed"; }
function c749() { const o = [1].values().next(); const said = hc749(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc749.has(o) + Sc749.read(o); }
function hc750(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c750() { const o = [1].entries().next().value; const said = hc750(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc751(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c751() { const o = [1].entries().next().value; const said = hc751(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc752(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c752() { const o = [1].entries().next().value; const said = hc752(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc753(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c753() { const o = [1].entries().next().value; const said = hc753(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc754(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c754() { const o = [1].entries().next().value; const said = hc754(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc755(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c755() { const o = [1].entries().next().value; const said = hc755(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc756(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c756() { const o = [1].entries().next().value; const said = hc756(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc757(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c757() { const o = [1].entries().next().value; const said = hc757(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc758(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c758() { const o = [1].entries().next().value; const said = hc758(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc759(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c759() { const o = [1].entries().next().value; const said = hc759(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc760(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c760() { const o = [1].entries().next().value; const said = hc760(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc761(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c761() { const o = [1].entries().next().value; const said = hc761(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc762(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c762() { const o = [1].entries().next().value; const said = hc762(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc763(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c763() { const o = [1].entries().next().value; const said = hc763(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc764(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c764() { const o = [1].entries().next().value; const said = hc764(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc765(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c765() { const o = [1].entries().next().value; const said = hc765(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc766(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c766() { const o = [1].entries().next().value; const said = hc766(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc767(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c767() { const o = [1].entries().next().value; const said = hc767(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc768(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c768() { const o = [1].entries().next().value; const said = hc768(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc769(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c769() { const o = [1].entries().next().value; const said = hc769(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc770(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c770() { const o = [1].entries().next().value; const said = hc770(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc771(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c771() { const o = [1].entries().next().value; const said = hc771(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc772(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c772() { const o = [1].entries().next().value; const said = hc772(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc773(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c773() { const o = [1].entries().next().value; const said = hc773(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc774 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc774(X) { try { new Sc774(X); } catch (e) { return e.name; } return "changed"; }
function c774() { const o = [1].entries().next().value; const said = hc774(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc774.has(o) + Sc774.read(o); }
function hc775(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c775() { const o = new Map([[1, 2]]).entries().next().value; const said = hc775(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc776(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c776() { const o = new Map([[1, 2]]).entries().next().value; const said = hc776(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc777(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c777() { const o = new Map([[1, 2]]).entries().next().value; const said = hc777(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc778(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c778() { const o = new Map([[1, 2]]).entries().next().value; const said = hc778(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc779(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c779() { const o = new Map([[1, 2]]).entries().next().value; const said = hc779(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc780(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c780() { const o = new Map([[1, 2]]).entries().next().value; const said = hc780(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc781(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c781() { const o = new Map([[1, 2]]).entries().next().value; const said = hc781(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc782(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c782() { const o = new Map([[1, 2]]).entries().next().value; const said = hc782(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc783(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c783() { const o = new Map([[1, 2]]).entries().next().value; const said = hc783(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc784(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c784() { const o = new Map([[1, 2]]).entries().next().value; const said = hc784(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc785(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c785() { const o = new Map([[1, 2]]).entries().next().value; const said = hc785(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc786(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c786() { const o = new Map([[1, 2]]).entries().next().value; const said = hc786(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc787(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c787() { const o = new Map([[1, 2]]).entries().next().value; const said = hc787(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc788(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c788() { const o = new Map([[1, 2]]).entries().next().value; const said = hc788(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc789(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c789() { const o = new Map([[1, 2]]).entries().next().value; const said = hc789(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc790(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c790() { const o = new Map([[1, 2]]).entries().next().value; const said = hc790(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc791(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c791() { const o = new Map([[1, 2]]).entries().next().value; const said = hc791(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc792(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c792() { const o = new Map([[1, 2]]).entries().next().value; const said = hc792(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc793(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c793() { const o = new Map([[1, 2]]).entries().next().value; const said = hc793(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc794(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c794() { const o = new Map([[1, 2]]).entries().next().value; const said = hc794(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc795(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c795() { const o = new Map([[1, 2]]).entries().next().value; const said = hc795(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc796(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c796() { const o = new Map([[1, 2]]).entries().next().value; const said = hc796(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc797(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c797() { const o = new Map([[1, 2]]).entries().next().value; const said = hc797(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc798(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c798() { const o = new Map([[1, 2]]).entries().next().value; const said = hc798(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc799 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc799(X) { try { new Sc799(X); } catch (e) { return e.name; } return "changed"; }
function c799() { const o = new Map([[1, 2]]).entries().next().value; const said = hc799(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc799.has(o) + Sc799.read(o); }
function hc800(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c800() { const o = (function* () { yield 1; })().next(); const said = hc800(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc801(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c801() { const o = (function* () { yield 1; })().next(); const said = hc801(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc802(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c802() { const o = (function* () { yield 1; })().next(); const said = hc802(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc803(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c803() { const o = (function* () { yield 1; })().next(); const said = hc803(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc804(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c804() { const o = (function* () { yield 1; })().next(); const said = hc804(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc805(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c805() { const o = (function* () { yield 1; })().next(); const said = hc805(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc806(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c806() { const o = (function* () { yield 1; })().next(); const said = hc806(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc807(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c807() { const o = (function* () { yield 1; })().next(); const said = hc807(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc808(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c808() { const o = (function* () { yield 1; })().next(); const said = hc808(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc809(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c809() { const o = (function* () { yield 1; })().next(); const said = hc809(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc810(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c810() { const o = (function* () { yield 1; })().next(); const said = hc810(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc811(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c811() { const o = (function* () { yield 1; })().next(); const said = hc811(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc812(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c812() { const o = (function* () { yield 1; })().next(); const said = hc812(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc813(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c813() { const o = (function* () { yield 1; })().next(); const said = hc813(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc814(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c814() { const o = (function* () { yield 1; })().next(); const said = hc814(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc815(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c815() { const o = (function* () { yield 1; })().next(); const said = hc815(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc816(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c816() { const o = (function* () { yield 1; })().next(); const said = hc816(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc817(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c817() { const o = (function* () { yield 1; })().next(); const said = hc817(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc818(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c818() { const o = (function* () { yield 1; })().next(); const said = hc818(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc819(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c819() { const o = (function* () { yield 1; })().next(); const said = hc819(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc820(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c820() { const o = (function* () { yield 1; })().next(); const said = hc820(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc821(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c821() { const o = (function* () { yield 1; })().next(); const said = hc821(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc822(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c822() { const o = (function* () { yield 1; })().next(); const said = hc822(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc823(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c823() { const o = (function* () { yield 1; })().next(); const said = hc823(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc824 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc824(X) { try { new Sc824(X); } catch (e) { return e.name; } return "changed"; }
function c824() { const o = (function* () { yield 1; })().next(); const said = hc824(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc824.has(o) + Sc824.read(o); }
function hc825(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c825() { const o = "ab".match(/a/); const said = hc825(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc826(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c826() { const o = "ab".match(/a/); const said = hc826(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc827(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c827() { const o = "ab".match(/a/); const said = hc827(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc828(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c828() { const o = "ab".match(/a/); const said = hc828(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc829(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c829() { const o = "ab".match(/a/); const said = hc829(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc830(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c830() { const o = "ab".match(/a/); const said = hc830(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc831(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c831() { const o = "ab".match(/a/); const said = hc831(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc832(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c832() { const o = "ab".match(/a/); const said = hc832(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc833(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c833() { const o = "ab".match(/a/); const said = hc833(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc834(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c834() { const o = "ab".match(/a/); const said = hc834(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc835(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c835() { const o = "ab".match(/a/); const said = hc835(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc836(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c836() { const o = "ab".match(/a/); const said = hc836(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc837(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c837() { const o = "ab".match(/a/); const said = hc837(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc838(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c838() { const o = "ab".match(/a/); const said = hc838(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc839(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c839() { const o = "ab".match(/a/); const said = hc839(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc840(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c840() { const o = "ab".match(/a/); const said = hc840(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc841(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c841() { const o = "ab".match(/a/); const said = hc841(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc842(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c842() { const o = "ab".match(/a/); const said = hc842(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc843(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c843() { const o = "ab".match(/a/); const said = hc843(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc844(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c844() { const o = "ab".match(/a/); const said = hc844(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc845(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c845() { const o = "ab".match(/a/); const said = hc845(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc846(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c846() { const o = "ab".match(/a/); const said = hc846(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc847(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c847() { const o = "ab".match(/a/); const said = hc847(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc848(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c848() { const o = "ab".match(/a/); const said = hc848(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc849 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc849(X) { try { new Sc849(X); } catch (e) { return e.name; } return "changed"; }
function c849() { const o = "ab".match(/a/); const said = hc849(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc849.has(o) + Sc849.read(o); }
function hc850(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c850() { const o = "ab".match(/(?<x>a)/).groups; const said = hc850(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc851(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c851() { const o = "ab".match(/(?<x>a)/).groups; const said = hc851(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc852(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c852() { const o = "ab".match(/(?<x>a)/).groups; const said = hc852(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc853(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c853() { const o = "ab".match(/(?<x>a)/).groups; const said = hc853(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc854(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c854() { const o = "ab".match(/(?<x>a)/).groups; const said = hc854(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc855(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c855() { const o = "ab".match(/(?<x>a)/).groups; const said = hc855(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc856(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c856() { const o = "ab".match(/(?<x>a)/).groups; const said = hc856(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc857(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c857() { const o = "ab".match(/(?<x>a)/).groups; const said = hc857(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc858(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c858() { const o = "ab".match(/(?<x>a)/).groups; const said = hc858(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc859(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c859() { const o = "ab".match(/(?<x>a)/).groups; const said = hc859(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc860(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c860() { const o = "ab".match(/(?<x>a)/).groups; const said = hc860(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc861(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c861() { const o = "ab".match(/(?<x>a)/).groups; const said = hc861(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc862(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c862() { const o = "ab".match(/(?<x>a)/).groups; const said = hc862(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc863(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c863() { const o = "ab".match(/(?<x>a)/).groups; const said = hc863(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc864(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c864() { const o = "ab".match(/(?<x>a)/).groups; const said = hc864(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc865(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c865() { const o = "ab".match(/(?<x>a)/).groups; const said = hc865(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc866(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c866() { const o = "ab".match(/(?<x>a)/).groups; const said = hc866(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc867(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c867() { const o = "ab".match(/(?<x>a)/).groups; const said = hc867(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc868(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c868() { const o = "ab".match(/(?<x>a)/).groups; const said = hc868(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc869(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c869() { const o = "ab".match(/(?<x>a)/).groups; const said = hc869(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc870(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c870() { const o = "ab".match(/(?<x>a)/).groups; const said = hc870(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc871(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c871() { const o = "ab".match(/(?<x>a)/).groups; const said = hc871(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc872(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c872() { const o = "ab".match(/(?<x>a)/).groups; const said = hc872(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc873(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c873() { const o = "ab".match(/(?<x>a)/).groups; const said = hc873(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc874 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc874(X) { try { new Sc874(X); } catch (e) { return e.name; } return "changed"; }
function c874() { const o = "ab".match(/(?<x>a)/).groups; const said = hc874(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc874.has(o) + Sc874.read(o); }
function hc875(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c875() { const o = "aa".match(/a/g); const said = hc875(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc876(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c876() { const o = "aa".match(/a/g); const said = hc876(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc877(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c877() { const o = "aa".match(/a/g); const said = hc877(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc878(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c878() { const o = "aa".match(/a/g); const said = hc878(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc879(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c879() { const o = "aa".match(/a/g); const said = hc879(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc880(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c880() { const o = "aa".match(/a/g); const said = hc880(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc881(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c881() { const o = "aa".match(/a/g); const said = hc881(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc882(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c882() { const o = "aa".match(/a/g); const said = hc882(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc883(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c883() { const o = "aa".match(/a/g); const said = hc883(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc884(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c884() { const o = "aa".match(/a/g); const said = hc884(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc885(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c885() { const o = "aa".match(/a/g); const said = hc885(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc886(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c886() { const o = "aa".match(/a/g); const said = hc886(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc887(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c887() { const o = "aa".match(/a/g); const said = hc887(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc888(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c888() { const o = "aa".match(/a/g); const said = hc888(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc889(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c889() { const o = "aa".match(/a/g); const said = hc889(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc890(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c890() { const o = "aa".match(/a/g); const said = hc890(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc891(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c891() { const o = "aa".match(/a/g); const said = hc891(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc892(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c892() { const o = "aa".match(/a/g); const said = hc892(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc893(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c893() { const o = "aa".match(/a/g); const said = hc893(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc894(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c894() { const o = "aa".match(/a/g); const said = hc894(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc895(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c895() { const o = "aa".match(/a/g); const said = hc895(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc896(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c896() { const o = "aa".match(/a/g); const said = hc896(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc897(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c897() { const o = "aa".match(/a/g); const said = hc897(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc898(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c898() { const o = "aa".match(/a/g); const said = hc898(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc899 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc899(X) { try { new Sc899(X); } catch (e) { return e.name; } return "changed"; }
function c899() { const o = "aa".match(/a/g); const said = hc899(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc899.has(o) + Sc899.read(o); }
function hc900(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c900() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc900(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc901(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c901() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc901(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc902(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c902() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc902(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc903(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c903() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc903(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc904(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c904() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc904(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc905(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c905() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc905(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc906(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c906() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc906(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc907(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c907() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc907(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc908(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c908() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc908(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc909(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c909() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc909(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc910(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c910() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc910(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc911(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c911() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc911(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc912(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c912() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc912(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc913(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c913() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc913(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc914(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c914() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc914(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc915(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c915() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc915(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc916(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c916() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc916(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc917(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c917() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc917(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc918(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c918() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc918(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc919(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c919() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc919(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc920(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c920() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc920(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc921(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c921() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc921(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc922(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c922() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc922(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc923(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c923() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc923(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc924 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc924(X) { try { new Sc924(X); } catch (e) { return e.name; } return "changed"; }
function c924() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc924(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc924.has(o) + Sc924.read(o); }
function hc925(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c925() { const o = /a/.exec("a"); const said = hc925(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc926(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c926() { const o = /a/.exec("a"); const said = hc926(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc927(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c927() { const o = /a/.exec("a"); const said = hc927(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc928(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c928() { const o = /a/.exec("a"); const said = hc928(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc929(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c929() { const o = /a/.exec("a"); const said = hc929(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc930(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c930() { const o = /a/.exec("a"); const said = hc930(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc931(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c931() { const o = /a/.exec("a"); const said = hc931(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc932(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c932() { const o = /a/.exec("a"); const said = hc932(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc933(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c933() { const o = /a/.exec("a"); const said = hc933(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc934(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c934() { const o = /a/.exec("a"); const said = hc934(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc935(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c935() { const o = /a/.exec("a"); const said = hc935(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc936(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c936() { const o = /a/.exec("a"); const said = hc936(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc937(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c937() { const o = /a/.exec("a"); const said = hc937(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc938(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c938() { const o = /a/.exec("a"); const said = hc938(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc939(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c939() { const o = /a/.exec("a"); const said = hc939(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc940(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c940() { const o = /a/.exec("a"); const said = hc940(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc941(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c941() { const o = /a/.exec("a"); const said = hc941(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc942(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c942() { const o = /a/.exec("a"); const said = hc942(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc943(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c943() { const o = /a/.exec("a"); const said = hc943(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc944(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c944() { const o = /a/.exec("a"); const said = hc944(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc945(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c945() { const o = /a/.exec("a"); const said = hc945(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc946(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c946() { const o = /a/.exec("a"); const said = hc946(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc947(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c947() { const o = /a/.exec("a"); const said = hc947(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc948(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c948() { const o = /a/.exec("a"); const said = hc948(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc949 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc949(X) { try { new Sc949(X); } catch (e) { return e.name; } return "changed"; }
function c949() { const o = /a/.exec("a"); const said = hc949(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc949.has(o) + Sc949.read(o); }
function hc950(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c950() { const o = /a/d.exec("a").indices; const said = hc950(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc951(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c951() { const o = /a/d.exec("a").indices; const said = hc951(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc952(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c952() { const o = /a/d.exec("a").indices; const said = hc952(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc953(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c953() { const o = /a/d.exec("a").indices; const said = hc953(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc954(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c954() { const o = /a/d.exec("a").indices; const said = hc954(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc955(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c955() { const o = /a/d.exec("a").indices; const said = hc955(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc956(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c956() { const o = /a/d.exec("a").indices; const said = hc956(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc957(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c957() { const o = /a/d.exec("a").indices; const said = hc957(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc958(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c958() { const o = /a/d.exec("a").indices; const said = hc958(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc959(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c959() { const o = /a/d.exec("a").indices; const said = hc959(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc960(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c960() { const o = /a/d.exec("a").indices; const said = hc960(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc961(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c961() { const o = /a/d.exec("a").indices; const said = hc961(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc962(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c962() { const o = /a/d.exec("a").indices; const said = hc962(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc963(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c963() { const o = /a/d.exec("a").indices; const said = hc963(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc964(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c964() { const o = /a/d.exec("a").indices; const said = hc964(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc965(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c965() { const o = /a/d.exec("a").indices; const said = hc965(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc966(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c966() { const o = /a/d.exec("a").indices; const said = hc966(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc967(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c967() { const o = /a/d.exec("a").indices; const said = hc967(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc968(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c968() { const o = /a/d.exec("a").indices; const said = hc968(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc969(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c969() { const o = /a/d.exec("a").indices; const said = hc969(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc970(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c970() { const o = /a/d.exec("a").indices; const said = hc970(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc971(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c971() { const o = /a/d.exec("a").indices; const said = hc971(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc972(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c972() { const o = /a/d.exec("a").indices; const said = hc972(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc973(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c973() { const o = /a/d.exec("a").indices; const said = hc973(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc974 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc974(X) { try { new Sc974(X); } catch (e) { return e.name; } return "changed"; }
function c974() { const o = /a/d.exec("a").indices; const said = hc974(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc974.has(o) + Sc974.read(o); }
function hc975(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c975() { const o = "a,b".split(","); const said = hc975(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc976(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c976() { const o = "a,b".split(","); const said = hc976(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc977(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c977() { const o = "a,b".split(","); const said = hc977(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc978(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c978() { const o = "a,b".split(","); const said = hc978(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc979(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c979() { const o = "a,b".split(","); const said = hc979(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc980(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c980() { const o = "a,b".split(","); const said = hc980(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc981(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c981() { const o = "a,b".split(","); const said = hc981(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc982(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c982() { const o = "a,b".split(","); const said = hc982(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc983(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c983() { const o = "a,b".split(","); const said = hc983(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc984(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c984() { const o = "a,b".split(","); const said = hc984(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc985(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c985() { const o = "a,b".split(","); const said = hc985(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc986(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c986() { const o = "a,b".split(","); const said = hc986(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc987(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c987() { const o = "a,b".split(","); const said = hc987(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc988(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c988() { const o = "a,b".split(","); const said = hc988(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc989(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c989() { const o = "a,b".split(","); const said = hc989(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc990(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c990() { const o = "a,b".split(","); const said = hc990(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc991(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c991() { const o = "a,b".split(","); const said = hc991(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc992(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c992() { const o = "a,b".split(","); const said = hc992(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc993(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c993() { const o = "a,b".split(","); const said = hc993(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc994(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c994() { const o = "a,b".split(","); const said = hc994(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc995(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c995() { const o = "a,b".split(","); const said = hc995(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc996(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c996() { const o = "a,b".split(","); const said = hc996(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc997(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c997() { const o = "a,b".split(","); const said = hc997(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc998(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c998() { const o = "a,b".split(","); const said = hc998(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc999 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc999(X) { try { new Sc999(X); } catch (e) { return e.name; } return "changed"; }
function c999() { const o = "a,b".split(","); const said = hc999(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc999.has(o) + Sc999.read(o); }
function hc1000(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1000() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1000(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1001(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1001() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1001(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1002(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1002() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1002(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1003(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1003() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1003(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1004(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1004() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1004(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1005(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1005() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1005(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1006(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1006() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1006(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1007(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1007() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1007(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1008(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1008() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1008(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1009(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1009() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1009(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1010(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1010() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1010(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1011(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1011() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1011(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1012(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1012() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1012(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1013(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1013() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1013(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1014(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1014() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1014(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1015(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1015() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1015(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1016(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1016() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1016(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1017(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1017() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1017(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1018(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1018() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1018(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1019(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1019() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1019(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1020(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1020() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1020(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1021(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1021() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1021(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1022(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1022() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1022(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1023(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1023() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1023(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1024 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1024(X) { try { new Sc1024(X); } catch (e) { return e.name; } return "changed"; }
function c1024() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1024(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1024.has(o) + Sc1024.read(o); }
function hc1025(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1025() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1025(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1026(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1026() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1026(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1027(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1027() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1027(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1028(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1028() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1028(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1029(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1029() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1029(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1030(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1030() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1030(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1031(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1031() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1031(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1032(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1032() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1032(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1033(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1033() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1033(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1034(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1034() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1034(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1035(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1035() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1035(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1036(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1036() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1036(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1037(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1037() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1037(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1038(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1038() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1038(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1039(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1039() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1039(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1040(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1040() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1040(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1041(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1041() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1041(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1042(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1042() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1042(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1043(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1043() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1043(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1044(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1044() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1044(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1045(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1045() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1045(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1046(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1046() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1046(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1047(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1047() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1047(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1048(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1048() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1048(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1049 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1049(X) { try { new Sc1049(X); } catch (e) { return e.name; } return "changed"; }
function c1049() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1049(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1049.has(o) + Sc1049.read(o); }
function hc1050(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1050() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1050(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1051(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1051() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1051(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1052(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1052() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1052(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1053(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1053() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1053(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1054(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1054() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1054(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1055(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1055() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1055(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1056(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1056() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1056(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1057(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1057() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1057(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1058(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1058() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1058(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1059(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1059() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1059(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1060(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1060() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1060(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1061(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1061() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1061(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1062(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1062() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1062(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1063(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1063() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1063(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1064(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1064() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1064(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1065(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1065() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1065(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1066(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1066() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1066(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1067(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1067() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1067(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1068(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1068() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1068(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1069(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1069() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1069(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1070(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1070() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1070(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1071(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1071() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1071(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1072(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1072() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1072(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1073(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1073() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1073(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1074 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1074(X) { try { new Sc1074(X); } catch (e) { return e.name; } return "changed"; }
function c1074() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1074(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1074.has(o) + Sc1074.read(o); }
function hc1075(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1075() { const o = Intl.getCanonicalLocales('en'); const said = hc1075(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1076(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1076() { const o = Intl.getCanonicalLocales('en'); const said = hc1076(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1077(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1077() { const o = Intl.getCanonicalLocales('en'); const said = hc1077(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1078(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1078() { const o = Intl.getCanonicalLocales('en'); const said = hc1078(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1079(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1079() { const o = Intl.getCanonicalLocales('en'); const said = hc1079(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1080(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1080() { const o = Intl.getCanonicalLocales('en'); const said = hc1080(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1081(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1081() { const o = Intl.getCanonicalLocales('en'); const said = hc1081(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1082(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1082() { const o = Intl.getCanonicalLocales('en'); const said = hc1082(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1083(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1083() { const o = Intl.getCanonicalLocales('en'); const said = hc1083(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1084(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1084() { const o = Intl.getCanonicalLocales('en'); const said = hc1084(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1085(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1085() { const o = Intl.getCanonicalLocales('en'); const said = hc1085(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1086(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1086() { const o = Intl.getCanonicalLocales('en'); const said = hc1086(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1087(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1087() { const o = Intl.getCanonicalLocales('en'); const said = hc1087(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1088(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1088() { const o = Intl.getCanonicalLocales('en'); const said = hc1088(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1089(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1089() { const o = Intl.getCanonicalLocales('en'); const said = hc1089(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1090(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1090() { const o = Intl.getCanonicalLocales('en'); const said = hc1090(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1091(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1091() { const o = Intl.getCanonicalLocales('en'); const said = hc1091(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1092(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1092() { const o = Intl.getCanonicalLocales('en'); const said = hc1092(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1093(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1093() { const o = Intl.getCanonicalLocales('en'); const said = hc1093(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1094(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1094() { const o = Intl.getCanonicalLocales('en'); const said = hc1094(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1095(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1095() { const o = Intl.getCanonicalLocales('en'); const said = hc1095(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1096(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1096() { const o = Intl.getCanonicalLocales('en'); const said = hc1096(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1097(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1097() { const o = Intl.getCanonicalLocales('en'); const said = hc1097(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1098(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1098() { const o = Intl.getCanonicalLocales('en'); const said = hc1098(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1099 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1099(X) { try { new Sc1099(X); } catch (e) { return e.name; } return "changed"; }
function c1099() { const o = Intl.getCanonicalLocales('en'); const said = hc1099(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1099.has(o) + Sc1099.read(o); }
function hc1100(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1100() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1100(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1101(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1101() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1101(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1102(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1102() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1102(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1103(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1103() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1103(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1104(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1104() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1104(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1105(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1105() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1105(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1106(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1106() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1106(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1107(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1107() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1107(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1108(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1108() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1108(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1109(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1109() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1109(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1110(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1110() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1110(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1111(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1111() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1111(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1112(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1112() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1112(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1113(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1113() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1113(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1114(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1114() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1114(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1115(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1115() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1115(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1116(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1116() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1116(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1117(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1117() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1117(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1118(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1118() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1118(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1119(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1119() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1119(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1120(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1120() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1120(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1121(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1121() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1121(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1122(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1122() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1122(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1123(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1123() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1123(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1124 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1124(X) { try { new Sc1124(X); } catch (e) { return e.name; } return "changed"; }
function c1124() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1124(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1124.has(o) + Sc1124.read(o); }
function hc1125(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1125() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1125(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1126(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1126() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1126(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1127(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1127() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1127(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1128(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1128() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1128(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1129(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1129() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1129(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1130(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1130() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1130(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1131(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1131() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1131(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1132(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1132() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1132(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1133(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1133() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1133(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1134(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1134() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1134(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1135(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1135() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1135(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1136(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1136() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1136(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1137(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1137() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1137(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1138(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1138() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1138(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1139(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1139() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1139(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1140(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1140() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1140(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1141(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1141() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1141(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1142(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1142() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1142(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1143(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1143() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1143(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1144(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1144() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1144(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1145(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1145() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1145(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1146(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1146() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1146(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1147(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1147() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1147(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1148(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1148() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1148(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1149 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1149(X) { try { new Sc1149(X); } catch (e) { return e.name; } return "changed"; }
function c1149() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1149(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1149.has(o) + Sc1149.read(o); }
function hc1150(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1150() { const o = [...new Headers({ a: "1" })][0]; const said = hc1150(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1151(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1151() { const o = [...new Headers({ a: "1" })][0]; const said = hc1151(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1152(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1152() { const o = [...new Headers({ a: "1" })][0]; const said = hc1152(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1153(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1153() { const o = [...new Headers({ a: "1" })][0]; const said = hc1153(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1154(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1154() { const o = [...new Headers({ a: "1" })][0]; const said = hc1154(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1155(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1155() { const o = [...new Headers({ a: "1" })][0]; const said = hc1155(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1156(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1156() { const o = [...new Headers({ a: "1" })][0]; const said = hc1156(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1157(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1157() { const o = [...new Headers({ a: "1" })][0]; const said = hc1157(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1158(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1158() { const o = [...new Headers({ a: "1" })][0]; const said = hc1158(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1159(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1159() { const o = [...new Headers({ a: "1" })][0]; const said = hc1159(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1160(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1160() { const o = [...new Headers({ a: "1" })][0]; const said = hc1160(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1161(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1161() { const o = [...new Headers({ a: "1" })][0]; const said = hc1161(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1162(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1162() { const o = [...new Headers({ a: "1" })][0]; const said = hc1162(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1163(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1163() { const o = [...new Headers({ a: "1" })][0]; const said = hc1163(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1164(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1164() { const o = [...new Headers({ a: "1" })][0]; const said = hc1164(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1165(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1165() { const o = [...new Headers({ a: "1" })][0]; const said = hc1165(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1166(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1166() { const o = [...new Headers({ a: "1" })][0]; const said = hc1166(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1167(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1167() { const o = [...new Headers({ a: "1" })][0]; const said = hc1167(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1168(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1168() { const o = [...new Headers({ a: "1" })][0]; const said = hc1168(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1169(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1169() { const o = [...new Headers({ a: "1" })][0]; const said = hc1169(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1170(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1170() { const o = [...new Headers({ a: "1" })][0]; const said = hc1170(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1171(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1171() { const o = [...new Headers({ a: "1" })][0]; const said = hc1171(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1172(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1172() { const o = [...new Headers({ a: "1" })][0]; const said = hc1172(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1173(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1173() { const o = [...new Headers({ a: "1" })][0]; const said = hc1173(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1174 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1174(X) { try { new Sc1174(X); } catch (e) { return e.name; } return "changed"; }
function c1174() { const o = [...new Headers({ a: "1" })][0]; const said = hc1174(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1174.has(o) + Sc1174.read(o); }
function hc1175(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1175() { const o = [1].map(x => x); const said = hc1175(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1176(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1176() { const o = [1].map(x => x); const said = hc1176(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1177(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1177() { const o = [1].map(x => x); const said = hc1177(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1178(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1178() { const o = [1].map(x => x); const said = hc1178(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1179(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1179() { const o = [1].map(x => x); const said = hc1179(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1180(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1180() { const o = [1].map(x => x); const said = hc1180(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1181(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1181() { const o = [1].map(x => x); const said = hc1181(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1182(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1182() { const o = [1].map(x => x); const said = hc1182(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1183(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1183() { const o = [1].map(x => x); const said = hc1183(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1184(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1184() { const o = [1].map(x => x); const said = hc1184(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1185(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1185() { const o = [1].map(x => x); const said = hc1185(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1186(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1186() { const o = [1].map(x => x); const said = hc1186(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1187(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1187() { const o = [1].map(x => x); const said = hc1187(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1188(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1188() { const o = [1].map(x => x); const said = hc1188(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1189(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1189() { const o = [1].map(x => x); const said = hc1189(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1190(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1190() { const o = [1].map(x => x); const said = hc1190(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1191(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1191() { const o = [1].map(x => x); const said = hc1191(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1192(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1192() { const o = [1].map(x => x); const said = hc1192(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1193(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1193() { const o = [1].map(x => x); const said = hc1193(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1194(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1194() { const o = [1].map(x => x); const said = hc1194(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1195(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1195() { const o = [1].map(x => x); const said = hc1195(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1196(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1196() { const o = [1].map(x => x); const said = hc1196(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1197(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1197() { const o = [1].map(x => x); const said = hc1197(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1198(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1198() { const o = [1].map(x => x); const said = hc1198(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1199 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1199(X) { try { new Sc1199(X); } catch (e) { return e.name; } return "changed"; }
function c1199() { const o = [1].map(x => x); const said = hc1199(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1199.has(o) + Sc1199.read(o); }
function hc1200(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1200() { const o = [1].filter(x => x); const said = hc1200(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1201(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1201() { const o = [1].filter(x => x); const said = hc1201(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1202(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1202() { const o = [1].filter(x => x); const said = hc1202(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1203(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1203() { const o = [1].filter(x => x); const said = hc1203(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1204(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1204() { const o = [1].filter(x => x); const said = hc1204(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1205(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1205() { const o = [1].filter(x => x); const said = hc1205(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1206(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1206() { const o = [1].filter(x => x); const said = hc1206(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1207(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1207() { const o = [1].filter(x => x); const said = hc1207(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1208(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1208() { const o = [1].filter(x => x); const said = hc1208(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1209(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1209() { const o = [1].filter(x => x); const said = hc1209(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1210(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1210() { const o = [1].filter(x => x); const said = hc1210(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1211(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1211() { const o = [1].filter(x => x); const said = hc1211(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1212(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1212() { const o = [1].filter(x => x); const said = hc1212(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1213(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1213() { const o = [1].filter(x => x); const said = hc1213(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1214(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1214() { const o = [1].filter(x => x); const said = hc1214(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1215(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1215() { const o = [1].filter(x => x); const said = hc1215(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1216(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1216() { const o = [1].filter(x => x); const said = hc1216(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1217(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1217() { const o = [1].filter(x => x); const said = hc1217(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1218(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1218() { const o = [1].filter(x => x); const said = hc1218(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1219(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1219() { const o = [1].filter(x => x); const said = hc1219(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1220(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1220() { const o = [1].filter(x => x); const said = hc1220(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1221(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1221() { const o = [1].filter(x => x); const said = hc1221(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1222(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1222() { const o = [1].filter(x => x); const said = hc1222(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1223(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1223() { const o = [1].filter(x => x); const said = hc1223(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1224 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1224(X) { try { new Sc1224(X); } catch (e) { return e.name; } return "changed"; }
function c1224() { const o = [1].filter(x => x); const said = hc1224(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1224.has(o) + Sc1224.read(o); }
function hc1225(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1225() { const o = [1].concat(); const said = hc1225(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1226(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1226() { const o = [1].concat(); const said = hc1226(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1227(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1227() { const o = [1].concat(); const said = hc1227(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1228(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1228() { const o = [1].concat(); const said = hc1228(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1229(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1229() { const o = [1].concat(); const said = hc1229(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1230(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1230() { const o = [1].concat(); const said = hc1230(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1231(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1231() { const o = [1].concat(); const said = hc1231(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1232(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1232() { const o = [1].concat(); const said = hc1232(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1233(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1233() { const o = [1].concat(); const said = hc1233(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1234(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1234() { const o = [1].concat(); const said = hc1234(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1235(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1235() { const o = [1].concat(); const said = hc1235(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1236(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1236() { const o = [1].concat(); const said = hc1236(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1237(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1237() { const o = [1].concat(); const said = hc1237(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1238(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1238() { const o = [1].concat(); const said = hc1238(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1239(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1239() { const o = [1].concat(); const said = hc1239(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1240(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1240() { const o = [1].concat(); const said = hc1240(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1241(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1241() { const o = [1].concat(); const said = hc1241(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1242(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1242() { const o = [1].concat(); const said = hc1242(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1243(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1243() { const o = [1].concat(); const said = hc1243(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1244(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1244() { const o = [1].concat(); const said = hc1244(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1245(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1245() { const o = [1].concat(); const said = hc1245(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1246(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1246() { const o = [1].concat(); const said = hc1246(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1247(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1247() { const o = [1].concat(); const said = hc1247(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1248(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1248() { const o = [1].concat(); const said = hc1248(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1249 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1249(X) { try { new Sc1249(X); } catch (e) { return e.name; } return "changed"; }
function c1249() { const o = [1].concat(); const said = hc1249(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1249.has(o) + Sc1249.read(o); }
function hc1250(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1250() { const o = [1].slice(); const said = hc1250(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1251(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1251() { const o = [1].slice(); const said = hc1251(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1252(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1252() { const o = [1].slice(); const said = hc1252(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1253(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1253() { const o = [1].slice(); const said = hc1253(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1254(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1254() { const o = [1].slice(); const said = hc1254(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1255(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1255() { const o = [1].slice(); const said = hc1255(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1256(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1256() { const o = [1].slice(); const said = hc1256(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1257(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1257() { const o = [1].slice(); const said = hc1257(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1258(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1258() { const o = [1].slice(); const said = hc1258(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1259(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1259() { const o = [1].slice(); const said = hc1259(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1260(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1260() { const o = [1].slice(); const said = hc1260(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1261(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1261() { const o = [1].slice(); const said = hc1261(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1262(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1262() { const o = [1].slice(); const said = hc1262(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1263(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1263() { const o = [1].slice(); const said = hc1263(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1264(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1264() { const o = [1].slice(); const said = hc1264(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1265(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1265() { const o = [1].slice(); const said = hc1265(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1266(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1266() { const o = [1].slice(); const said = hc1266(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1267(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1267() { const o = [1].slice(); const said = hc1267(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1268(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1268() { const o = [1].slice(); const said = hc1268(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1269(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1269() { const o = [1].slice(); const said = hc1269(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1270(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1270() { const o = [1].slice(); const said = hc1270(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1271(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1271() { const o = [1].slice(); const said = hc1271(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1272(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1272() { const o = [1].slice(); const said = hc1272(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1273(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1273() { const o = [1].slice(); const said = hc1273(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1274 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1274(X) { try { new Sc1274(X); } catch (e) { return e.name; } return "changed"; }
function c1274() { const o = [1].slice(); const said = hc1274(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1274.has(o) + Sc1274.read(o); }
function hc1275(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1275() { const o = [[1]].flat(); const said = hc1275(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1276(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1276() { const o = [[1]].flat(); const said = hc1276(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1277(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1277() { const o = [[1]].flat(); const said = hc1277(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1278(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1278() { const o = [[1]].flat(); const said = hc1278(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1279(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1279() { const o = [[1]].flat(); const said = hc1279(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1280(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1280() { const o = [[1]].flat(); const said = hc1280(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1281(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1281() { const o = [[1]].flat(); const said = hc1281(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1282(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1282() { const o = [[1]].flat(); const said = hc1282(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1283(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1283() { const o = [[1]].flat(); const said = hc1283(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1284(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1284() { const o = [[1]].flat(); const said = hc1284(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1285(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1285() { const o = [[1]].flat(); const said = hc1285(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1286(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1286() { const o = [[1]].flat(); const said = hc1286(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1287(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1287() { const o = [[1]].flat(); const said = hc1287(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1288(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1288() { const o = [[1]].flat(); const said = hc1288(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1289(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1289() { const o = [[1]].flat(); const said = hc1289(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1290(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1290() { const o = [[1]].flat(); const said = hc1290(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1291(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1291() { const o = [[1]].flat(); const said = hc1291(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1292(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1292() { const o = [[1]].flat(); const said = hc1292(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1293(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1293() { const o = [[1]].flat(); const said = hc1293(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1294(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1294() { const o = [[1]].flat(); const said = hc1294(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1295(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1295() { const o = [[1]].flat(); const said = hc1295(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1296(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1296() { const o = [[1]].flat(); const said = hc1296(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1297(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1297() { const o = [[1]].flat(); const said = hc1297(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1298(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1298() { const o = [[1]].flat(); const said = hc1298(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1299 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1299(X) { try { new Sc1299(X); } catch (e) { return e.name; } return "changed"; }
function c1299() { const o = [[1]].flat(); const said = hc1299(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1299.has(o) + Sc1299.read(o); }
function hc1300(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1300() { const o = [1].toSorted(); const said = hc1300(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1301(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1301() { const o = [1].toSorted(); const said = hc1301(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1302(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1302() { const o = [1].toSorted(); const said = hc1302(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1303(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1303() { const o = [1].toSorted(); const said = hc1303(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1304(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1304() { const o = [1].toSorted(); const said = hc1304(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1305(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1305() { const o = [1].toSorted(); const said = hc1305(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1306(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1306() { const o = [1].toSorted(); const said = hc1306(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1307(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1307() { const o = [1].toSorted(); const said = hc1307(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1308(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1308() { const o = [1].toSorted(); const said = hc1308(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1309(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1309() { const o = [1].toSorted(); const said = hc1309(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1310(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1310() { const o = [1].toSorted(); const said = hc1310(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1311(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1311() { const o = [1].toSorted(); const said = hc1311(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1312(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1312() { const o = [1].toSorted(); const said = hc1312(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1313(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1313() { const o = [1].toSorted(); const said = hc1313(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1314(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1314() { const o = [1].toSorted(); const said = hc1314(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1315(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1315() { const o = [1].toSorted(); const said = hc1315(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1316(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1316() { const o = [1].toSorted(); const said = hc1316(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1317(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1317() { const o = [1].toSorted(); const said = hc1317(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1318(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1318() { const o = [1].toSorted(); const said = hc1318(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1319(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1319() { const o = [1].toSorted(); const said = hc1319(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1320(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1320() { const o = [1].toSorted(); const said = hc1320(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1321(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1321() { const o = [1].toSorted(); const said = hc1321(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1322(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1322() { const o = [1].toSorted(); const said = hc1322(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1323(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1323() { const o = [1].toSorted(); const said = hc1323(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1324 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1324(X) { try { new Sc1324(X); } catch (e) { return e.name; } return "changed"; }
function c1324() { const o = [1].toSorted(); const said = hc1324(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1324.has(o) + Sc1324.read(o); }
function hc1325(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1325() { const o = [1].with(0, 2); const said = hc1325(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1326(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1326() { const o = [1].with(0, 2); const said = hc1326(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1327(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1327() { const o = [1].with(0, 2); const said = hc1327(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1328(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1328() { const o = [1].with(0, 2); const said = hc1328(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1329(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1329() { const o = [1].with(0, 2); const said = hc1329(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1330(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1330() { const o = [1].with(0, 2); const said = hc1330(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1331(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1331() { const o = [1].with(0, 2); const said = hc1331(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1332(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1332() { const o = [1].with(0, 2); const said = hc1332(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1333(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1333() { const o = [1].with(0, 2); const said = hc1333(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1334(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1334() { const o = [1].with(0, 2); const said = hc1334(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1335(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1335() { const o = [1].with(0, 2); const said = hc1335(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1336(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1336() { const o = [1].with(0, 2); const said = hc1336(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1337(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1337() { const o = [1].with(0, 2); const said = hc1337(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1338(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1338() { const o = [1].with(0, 2); const said = hc1338(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1339(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1339() { const o = [1].with(0, 2); const said = hc1339(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1340(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1340() { const o = [1].with(0, 2); const said = hc1340(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1341(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1341() { const o = [1].with(0, 2); const said = hc1341(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1342(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1342() { const o = [1].with(0, 2); const said = hc1342(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1343(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1343() { const o = [1].with(0, 2); const said = hc1343(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1344(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1344() { const o = [1].with(0, 2); const said = hc1344(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1345(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1345() { const o = [1].with(0, 2); const said = hc1345(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1346(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1346() { const o = [1].with(0, 2); const said = hc1346(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1347(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1347() { const o = [1].with(0, 2); const said = hc1347(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1348(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1348() { const o = [1].with(0, 2); const said = hc1348(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1349 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1349(X) { try { new Sc1349(X); } catch (e) { return e.name; } return "changed"; }
function c1349() { const o = [1].with(0, 2); const said = hc1349(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1349.has(o) + Sc1349.read(o); }
function hc1350(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1350() { const o = [1, 2].splice(0, 1); const said = hc1350(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1351(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1351() { const o = [1, 2].splice(0, 1); const said = hc1351(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1352(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1352() { const o = [1, 2].splice(0, 1); const said = hc1352(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1353(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1353() { const o = [1, 2].splice(0, 1); const said = hc1353(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1354(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1354() { const o = [1, 2].splice(0, 1); const said = hc1354(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1355(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1355() { const o = [1, 2].splice(0, 1); const said = hc1355(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1356(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1356() { const o = [1, 2].splice(0, 1); const said = hc1356(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1357(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1357() { const o = [1, 2].splice(0, 1); const said = hc1357(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1358(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1358() { const o = [1, 2].splice(0, 1); const said = hc1358(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1359(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1359() { const o = [1, 2].splice(0, 1); const said = hc1359(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1360(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1360() { const o = [1, 2].splice(0, 1); const said = hc1360(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1361(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1361() { const o = [1, 2].splice(0, 1); const said = hc1361(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1362(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1362() { const o = [1, 2].splice(0, 1); const said = hc1362(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1363(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1363() { const o = [1, 2].splice(0, 1); const said = hc1363(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1364(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1364() { const o = [1, 2].splice(0, 1); const said = hc1364(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1365(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1365() { const o = [1, 2].splice(0, 1); const said = hc1365(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1366(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1366() { const o = [1, 2].splice(0, 1); const said = hc1366(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1367(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1367() { const o = [1, 2].splice(0, 1); const said = hc1367(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1368(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1368() { const o = [1, 2].splice(0, 1); const said = hc1368(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1369(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1369() { const o = [1, 2].splice(0, 1); const said = hc1369(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1370(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1370() { const o = [1, 2].splice(0, 1); const said = hc1370(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1371(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1371() { const o = [1, 2].splice(0, 1); const said = hc1371(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1372(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1372() { const o = [1, 2].splice(0, 1); const said = hc1372(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1373(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1373() { const o = [1, 2].splice(0, 1); const said = hc1373(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1374 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1374(X) { try { new Sc1374(X); } catch (e) { return e.name; } return "changed"; }
function c1374() { const o = [1, 2].splice(0, 1); const said = hc1374(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1374.has(o) + Sc1374.read(o); }
function hc1375(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1375() { const o = new Object(); const said = hc1375(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1376(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1376() { const o = new Object(); const said = hc1376(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1377(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1377() { const o = new Object(); const said = hc1377(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1378(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1378() { const o = new Object(); const said = hc1378(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1379(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1379() { const o = new Object(); const said = hc1379(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1380(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1380() { const o = new Object(); const said = hc1380(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1381(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1381() { const o = new Object(); const said = hc1381(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1382(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1382() { const o = new Object(); const said = hc1382(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1383(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1383() { const o = new Object(); const said = hc1383(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1384(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1384() { const o = new Object(); const said = hc1384(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1385(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1385() { const o = new Object(); const said = hc1385(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1386(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1386() { const o = new Object(); const said = hc1386(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1387(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1387() { const o = new Object(); const said = hc1387(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1388(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1388() { const o = new Object(); const said = hc1388(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1389(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1389() { const o = new Object(); const said = hc1389(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1390(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1390() { const o = new Object(); const said = hc1390(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1391(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1391() { const o = new Object(); const said = hc1391(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1392(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1392() { const o = new Object(); const said = hc1392(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1393(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1393() { const o = new Object(); const said = hc1393(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1394(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1394() { const o = new Object(); const said = hc1394(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1395(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1395() { const o = new Object(); const said = hc1395(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1396(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1396() { const o = new Object(); const said = hc1396(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1397(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1397() { const o = new Object(); const said = hc1397(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1398(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1398() { const o = new Object(); const said = hc1398(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1399 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1399(X) { try { new Sc1399(X); } catch (e) { return e.name; } return "changed"; }
function c1399() { const o = new Object(); const said = hc1399(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1399.has(o) + Sc1399.read(o); }
function hc1400(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1400() { const o = Object(); const said = hc1400(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1401(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1401() { const o = Object(); const said = hc1401(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1402(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1402() { const o = Object(); const said = hc1402(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1403(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1403() { const o = Object(); const said = hc1403(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1404(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1404() { const o = Object(); const said = hc1404(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1405(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1405() { const o = Object(); const said = hc1405(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1406(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1406() { const o = Object(); const said = hc1406(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1407(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1407() { const o = Object(); const said = hc1407(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1408(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1408() { const o = Object(); const said = hc1408(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1409(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1409() { const o = Object(); const said = hc1409(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1410(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1410() { const o = Object(); const said = hc1410(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1411(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1411() { const o = Object(); const said = hc1411(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1412(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1412() { const o = Object(); const said = hc1412(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1413(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1413() { const o = Object(); const said = hc1413(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1414(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1414() { const o = Object(); const said = hc1414(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1415(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1415() { const o = Object(); const said = hc1415(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1416(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1416() { const o = Object(); const said = hc1416(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1417(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1417() { const o = Object(); const said = hc1417(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1418(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1418() { const o = Object(); const said = hc1418(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1419(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1419() { const o = Object(); const said = hc1419(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1420(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1420() { const o = Object(); const said = hc1420(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1421(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1421() { const o = Object(); const said = hc1421(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1422(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1422() { const o = Object(); const said = hc1422(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1423(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1423() { const o = Object(); const said = hc1423(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1424 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1424(X) { try { new Sc1424(X); } catch (e) { return e.name; } return "changed"; }
function c1424() { const o = Object(); const said = hc1424(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1424.has(o) + Sc1424.read(o); }
function hc1425(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1425() { const o = Object(1); const said = hc1425(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1426(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1426() { const o = Object(1); const said = hc1426(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1427(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1427() { const o = Object(1); const said = hc1427(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1428(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1428() { const o = Object(1); const said = hc1428(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1429(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1429() { const o = Object(1); const said = hc1429(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1430(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1430() { const o = Object(1); const said = hc1430(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1431(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1431() { const o = Object(1); const said = hc1431(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1432(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1432() { const o = Object(1); const said = hc1432(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1433(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1433() { const o = Object(1); const said = hc1433(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1434(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1434() { const o = Object(1); const said = hc1434(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1435(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1435() { const o = Object(1); const said = hc1435(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1436(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1436() { const o = Object(1); const said = hc1436(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1437(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1437() { const o = Object(1); const said = hc1437(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1438(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1438() { const o = Object(1); const said = hc1438(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1439(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1439() { const o = Object(1); const said = hc1439(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1440(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1440() { const o = Object(1); const said = hc1440(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1441(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1441() { const o = Object(1); const said = hc1441(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1442(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1442() { const o = Object(1); const said = hc1442(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1443(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1443() { const o = Object(1); const said = hc1443(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1444(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1444() { const o = Object(1); const said = hc1444(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1445(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1445() { const o = Object(1); const said = hc1445(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1446(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1446() { const o = Object(1); const said = hc1446(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1447(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1447() { const o = Object(1); const said = hc1447(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1448(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1448() { const o = Object(1); const said = hc1448(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1449 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1449(X) { try { new Sc1449(X); } catch (e) { return e.name; } return "changed"; }
function c1449() { const o = Object(1); const said = hc1449(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1449.has(o) + Sc1449.read(o); }
function hc1450(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1450() { const o = Promise.withResolvers(); const said = hc1450(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1451(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1451() { const o = Promise.withResolvers(); const said = hc1451(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1452(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1452() { const o = Promise.withResolvers(); const said = hc1452(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1453(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1453() { const o = Promise.withResolvers(); const said = hc1453(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1454(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1454() { const o = Promise.withResolvers(); const said = hc1454(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1455(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1455() { const o = Promise.withResolvers(); const said = hc1455(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1456(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1456() { const o = Promise.withResolvers(); const said = hc1456(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1457(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1457() { const o = Promise.withResolvers(); const said = hc1457(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1458(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1458() { const o = Promise.withResolvers(); const said = hc1458(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1459(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1459() { const o = Promise.withResolvers(); const said = hc1459(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1460(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1460() { const o = Promise.withResolvers(); const said = hc1460(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1461(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1461() { const o = Promise.withResolvers(); const said = hc1461(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1462(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1462() { const o = Promise.withResolvers(); const said = hc1462(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1463(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1463() { const o = Promise.withResolvers(); const said = hc1463(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1464(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1464() { const o = Promise.withResolvers(); const said = hc1464(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1465(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1465() { const o = Promise.withResolvers(); const said = hc1465(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1466(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1466() { const o = Promise.withResolvers(); const said = hc1466(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1467(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1467() { const o = Promise.withResolvers(); const said = hc1467(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1468(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1468() { const o = Promise.withResolvers(); const said = hc1468(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1469(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1469() { const o = Promise.withResolvers(); const said = hc1469(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1470(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1470() { const o = Promise.withResolvers(); const said = hc1470(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1471(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1471() { const o = Promise.withResolvers(); const said = hc1471(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1472(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1472() { const o = Promise.withResolvers(); const said = hc1472(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1473(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1473() { const o = Promise.withResolvers(); const said = hc1473(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1474 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1474(X) { try { new Sc1474(X); } catch (e) { return e.name; } return "changed"; }
function c1474() { const o = Promise.withResolvers(); const said = hc1474(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1474.has(o) + Sc1474.read(o); }
function hc1475(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1475() { const o = { ...{ a: 1 } }; const said = hc1475(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1476(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1476() { const o = { ...{ a: 1 } }; const said = hc1476(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1477(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1477() { const o = { ...{ a: 1 } }; const said = hc1477(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1478(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1478() { const o = { ...{ a: 1 } }; const said = hc1478(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1479(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1479() { const o = { ...{ a: 1 } }; const said = hc1479(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1480(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1480() { const o = { ...{ a: 1 } }; const said = hc1480(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1481(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1481() { const o = { ...{ a: 1 } }; const said = hc1481(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1482(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1482() { const o = { ...{ a: 1 } }; const said = hc1482(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1483(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1483() { const o = { ...{ a: 1 } }; const said = hc1483(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1484(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1484() { const o = { ...{ a: 1 } }; const said = hc1484(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1485(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1485() { const o = { ...{ a: 1 } }; const said = hc1485(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1486(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1486() { const o = { ...{ a: 1 } }; const said = hc1486(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1487(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1487() { const o = { ...{ a: 1 } }; const said = hc1487(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1488(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1488() { const o = { ...{ a: 1 } }; const said = hc1488(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1489(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1489() { const o = { ...{ a: 1 } }; const said = hc1489(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1490(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1490() { const o = { ...{ a: 1 } }; const said = hc1490(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1491(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1491() { const o = { ...{ a: 1 } }; const said = hc1491(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1492(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1492() { const o = { ...{ a: 1 } }; const said = hc1492(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1493(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1493() { const o = { ...{ a: 1 } }; const said = hc1493(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1494(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1494() { const o = { ...{ a: 1 } }; const said = hc1494(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1495(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1495() { const o = { ...{ a: 1 } }; const said = hc1495(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1496(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1496() { const o = { ...{ a: 1 } }; const said = hc1496(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1497(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1497() { const o = { ...{ a: 1 } }; const said = hc1497(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1498(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1498() { const o = { ...{ a: 1 } }; const said = hc1498(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1499 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1499(X) { try { new Sc1499(X); } catch (e) { return e.name; } return "changed"; }
function c1499() { const o = { ...{ a: 1 } }; const said = hc1499(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1499.has(o) + Sc1499.read(o); }
function hc1500(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1500() { const o = [...[1]]; const said = hc1500(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1501(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1501() { const o = [...[1]]; const said = hc1501(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1502(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1502() { const o = [...[1]]; const said = hc1502(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1503(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1503() { const o = [...[1]]; const said = hc1503(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1504(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1504() { const o = [...[1]]; const said = hc1504(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1505(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1505() { const o = [...[1]]; const said = hc1505(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1506(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1506() { const o = [...[1]]; const said = hc1506(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1507(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1507() { const o = [...[1]]; const said = hc1507(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1508(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1508() { const o = [...[1]]; const said = hc1508(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1509(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1509() { const o = [...[1]]; const said = hc1509(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1510(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1510() { const o = [...[1]]; const said = hc1510(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1511(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1511() { const o = [...[1]]; const said = hc1511(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1512(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1512() { const o = [...[1]]; const said = hc1512(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1513(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1513() { const o = [...[1]]; const said = hc1513(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1514(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1514() { const o = [...[1]]; const said = hc1514(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1515(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1515() { const o = [...[1]]; const said = hc1515(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1516(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1516() { const o = [...[1]]; const said = hc1516(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1517(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1517() { const o = [...[1]]; const said = hc1517(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1518(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1518() { const o = [...[1]]; const said = hc1518(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1519(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1519() { const o = [...[1]]; const said = hc1519(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1520(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1520() { const o = [...[1]]; const said = hc1520(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1521(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1521() { const o = [...[1]]; const said = hc1521(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1522(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1522() { const o = [...[1]]; const said = hc1522(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1523(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1523() { const o = [...[1]]; const said = hc1523(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1524 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1524(X) { try { new Sc1524(X); } catch (e) { return e.name; } return "changed"; }
function c1524() { const o = [...[1]]; const said = hc1524(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1524.has(o) + Sc1524.read(o); }
function hc1525(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1525() { const o = ((...rest) => rest)(1); const said = hc1525(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1526(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1526() { const o = ((...rest) => rest)(1); const said = hc1526(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1527(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1527() { const o = ((...rest) => rest)(1); const said = hc1527(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1528(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1528() { const o = ((...rest) => rest)(1); const said = hc1528(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1529(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1529() { const o = ((...rest) => rest)(1); const said = hc1529(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1530(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1530() { const o = ((...rest) => rest)(1); const said = hc1530(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1531(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1531() { const o = ((...rest) => rest)(1); const said = hc1531(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1532(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1532() { const o = ((...rest) => rest)(1); const said = hc1532(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1533(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1533() { const o = ((...rest) => rest)(1); const said = hc1533(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1534(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1534() { const o = ((...rest) => rest)(1); const said = hc1534(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1535(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1535() { const o = ((...rest) => rest)(1); const said = hc1535(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1536(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1536() { const o = ((...rest) => rest)(1); const said = hc1536(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1537(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1537() { const o = ((...rest) => rest)(1); const said = hc1537(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1538(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1538() { const o = ((...rest) => rest)(1); const said = hc1538(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1539(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1539() { const o = ((...rest) => rest)(1); const said = hc1539(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1540(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1540() { const o = ((...rest) => rest)(1); const said = hc1540(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1541(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1541() { const o = ((...rest) => rest)(1); const said = hc1541(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1542(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1542() { const o = ((...rest) => rest)(1); const said = hc1542(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1543(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1543() { const o = ((...rest) => rest)(1); const said = hc1543(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1544(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1544() { const o = ((...rest) => rest)(1); const said = hc1544(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1545(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1545() { const o = ((...rest) => rest)(1); const said = hc1545(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1546(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1546() { const o = ((...rest) => rest)(1); const said = hc1546(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1547(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1547() { const o = ((...rest) => rest)(1); const said = hc1547(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1548(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1548() { const o = ((...rest) => rest)(1); const said = hc1548(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1549 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1549(X) { try { new Sc1549(X); } catch (e) { return e.name; } return "changed"; }
function c1549() { const o = ((...rest) => rest)(1); const said = hc1549(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1549.has(o) + Sc1549.read(o); }
function hc1550(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1550() { const o = (s => s)`a${1}b`; const said = hc1550(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1551(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1551() { const o = (s => s)`a${1}b`; const said = hc1551(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1552(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1552() { const o = (s => s)`a${1}b`; const said = hc1552(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1553(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1553() { const o = (s => s)`a${1}b`; const said = hc1553(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1554(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1554() { const o = (s => s)`a${1}b`; const said = hc1554(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1555(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1555() { const o = (s => s)`a${1}b`; const said = hc1555(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1556(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1556() { const o = (s => s)`a${1}b`; const said = hc1556(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1557(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1557() { const o = (s => s)`a${1}b`; const said = hc1557(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1558(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1558() { const o = (s => s)`a${1}b`; const said = hc1558(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1559(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1559() { const o = (s => s)`a${1}b`; const said = hc1559(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1560(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1560() { const o = (s => s)`a${1}b`; const said = hc1560(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1561(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1561() { const o = (s => s)`a${1}b`; const said = hc1561(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1562(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1562() { const o = (s => s)`a${1}b`; const said = hc1562(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1563(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1563() { const o = (s => s)`a${1}b`; const said = hc1563(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1564(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1564() { const o = (s => s)`a${1}b`; const said = hc1564(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1565(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1565() { const o = (s => s)`a${1}b`; const said = hc1565(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1566(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1566() { const o = (s => s)`a${1}b`; const said = hc1566(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1567(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1567() { const o = (s => s)`a${1}b`; const said = hc1567(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1568(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1568() { const o = (s => s)`a${1}b`; const said = hc1568(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1569(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1569() { const o = (s => s)`a${1}b`; const said = hc1569(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1570(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1570() { const o = (s => s)`a${1}b`; const said = hc1570(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1571(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1571() { const o = (s => s)`a${1}b`; const said = hc1571(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1572(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1572() { const o = (s => s)`a${1}b`; const said = hc1572(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1573(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1573() { const o = (s => s)`a${1}b`; const said = hc1573(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1574 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1574(X) { try { new Sc1574(X); } catch (e) { return e.name; } return "changed"; }
function c1574() { const o = (s => s)`a${1}b`; const said = hc1574(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1574.has(o) + Sc1574.read(o); }
function hc1575(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1575() { const o = (s => s)`a${1}b`.raw; const said = hc1575(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1576(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1576() { const o = (s => s)`a${1}b`.raw; const said = hc1576(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1577(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1577() { const o = (s => s)`a${1}b`.raw; const said = hc1577(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1578(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1578() { const o = (s => s)`a${1}b`.raw; const said = hc1578(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1579(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1579() { const o = (s => s)`a${1}b`.raw; const said = hc1579(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1580(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1580() { const o = (s => s)`a${1}b`.raw; const said = hc1580(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1581(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1581() { const o = (s => s)`a${1}b`.raw; const said = hc1581(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1582(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1582() { const o = (s => s)`a${1}b`.raw; const said = hc1582(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1583(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1583() { const o = (s => s)`a${1}b`.raw; const said = hc1583(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1584(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1584() { const o = (s => s)`a${1}b`.raw; const said = hc1584(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1585(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1585() { const o = (s => s)`a${1}b`.raw; const said = hc1585(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1586(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1586() { const o = (s => s)`a${1}b`.raw; const said = hc1586(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1587(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1587() { const o = (s => s)`a${1}b`.raw; const said = hc1587(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1588(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1588() { const o = (s => s)`a${1}b`.raw; const said = hc1588(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1589(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1589() { const o = (s => s)`a${1}b`.raw; const said = hc1589(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1590(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1590() { const o = (s => s)`a${1}b`.raw; const said = hc1590(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1591(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1591() { const o = (s => s)`a${1}b`.raw; const said = hc1591(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1592(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1592() { const o = (s => s)`a${1}b`.raw; const said = hc1592(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1593(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1593() { const o = (s => s)`a${1}b`.raw; const said = hc1593(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1594(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1594() { const o = (s => s)`a${1}b`.raw; const said = hc1594(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1595(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1595() { const o = (s => s)`a${1}b`.raw; const said = hc1595(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1596(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1596() { const o = (s => s)`a${1}b`.raw; const said = hc1596(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1597(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1597() { const o = (s => s)`a${1}b`.raw; const said = hc1597(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1598(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1598() { const o = (s => s)`a${1}b`.raw; const said = hc1598(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1599 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1599(X) { try { new Sc1599(X); } catch (e) { return e.name; } return "changed"; }
function c1599() { const o = (s => s)`a${1}b`.raw; const said = hc1599(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1599.has(o) + Sc1599.read(o); }
function hc1600(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1600() { const o = new Map(); const said = hc1600(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1601(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1601() { const o = new Map(); const said = hc1601(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1602(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1602() { const o = new Map(); const said = hc1602(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1603(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1603() { const o = new Map(); const said = hc1603(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1604(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1604() { const o = new Map(); const said = hc1604(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1605(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1605() { const o = new Map(); const said = hc1605(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1606(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1606() { const o = new Map(); const said = hc1606(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1607(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1607() { const o = new Map(); const said = hc1607(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1608(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1608() { const o = new Map(); const said = hc1608(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1609(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1609() { const o = new Map(); const said = hc1609(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1610(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1610() { const o = new Map(); const said = hc1610(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1611(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1611() { const o = new Map(); const said = hc1611(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1612(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1612() { const o = new Map(); const said = hc1612(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1613(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1613() { const o = new Map(); const said = hc1613(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1614(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1614() { const o = new Map(); const said = hc1614(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1615(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1615() { const o = new Map(); const said = hc1615(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1616(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1616() { const o = new Map(); const said = hc1616(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1617(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1617() { const o = new Map(); const said = hc1617(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1618(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1618() { const o = new Map(); const said = hc1618(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1619(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1619() { const o = new Map(); const said = hc1619(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1620(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1620() { const o = new Map(); const said = hc1620(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1621(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1621() { const o = new Map(); const said = hc1621(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1622(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1622() { const o = new Map(); const said = hc1622(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1623(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1623() { const o = new Map(); const said = hc1623(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1624 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1624(X) { try { new Sc1624(X); } catch (e) { return e.name; } return "changed"; }
function c1624() { const o = new Map(); const said = hc1624(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1624.has(o) + Sc1624.read(o); }
function hc1625(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1625() { const o = new Set(); const said = hc1625(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1626(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1626() { const o = new Set(); const said = hc1626(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1627(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1627() { const o = new Set(); const said = hc1627(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1628(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1628() { const o = new Set(); const said = hc1628(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1629(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1629() { const o = new Set(); const said = hc1629(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1630(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1630() { const o = new Set(); const said = hc1630(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1631(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1631() { const o = new Set(); const said = hc1631(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1632(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1632() { const o = new Set(); const said = hc1632(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1633(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1633() { const o = new Set(); const said = hc1633(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1634(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1634() { const o = new Set(); const said = hc1634(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1635(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1635() { const o = new Set(); const said = hc1635(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1636(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1636() { const o = new Set(); const said = hc1636(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1637(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1637() { const o = new Set(); const said = hc1637(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1638(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1638() { const o = new Set(); const said = hc1638(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1639(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1639() { const o = new Set(); const said = hc1639(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1640(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1640() { const o = new Set(); const said = hc1640(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1641(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1641() { const o = new Set(); const said = hc1641(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1642(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1642() { const o = new Set(); const said = hc1642(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1643(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1643() { const o = new Set(); const said = hc1643(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1644(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1644() { const o = new Set(); const said = hc1644(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1645(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1645() { const o = new Set(); const said = hc1645(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1646(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1646() { const o = new Set(); const said = hc1646(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1647(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1647() { const o = new Set(); const said = hc1647(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1648(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1648() { const o = new Set(); const said = hc1648(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1649 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1649(X) { try { new Sc1649(X); } catch (e) { return e.name; } return "changed"; }
function c1649() { const o = new Set(); const said = hc1649(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1649.has(o) + Sc1649.read(o); }
function hc1650(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1650() { const o = new Error("x"); const said = hc1650(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1651(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1651() { const o = new Error("x"); const said = hc1651(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1652(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1652() { const o = new Error("x"); const said = hc1652(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1653(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1653() { const o = new Error("x"); const said = hc1653(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1654(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1654() { const o = new Error("x"); const said = hc1654(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1655(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1655() { const o = new Error("x"); const said = hc1655(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1656(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1656() { const o = new Error("x"); const said = hc1656(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1657(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1657() { const o = new Error("x"); const said = hc1657(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1658(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1658() { const o = new Error("x"); const said = hc1658(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1659(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1659() { const o = new Error("x"); const said = hc1659(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1660(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1660() { const o = new Error("x"); const said = hc1660(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1661(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1661() { const o = new Error("x"); const said = hc1661(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1662(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1662() { const o = new Error("x"); const said = hc1662(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1663(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1663() { const o = new Error("x"); const said = hc1663(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1664(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1664() { const o = new Error("x"); const said = hc1664(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1665(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1665() { const o = new Error("x"); const said = hc1665(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1666(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1666() { const o = new Error("x"); const said = hc1666(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1667(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1667() { const o = new Error("x"); const said = hc1667(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1668(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1668() { const o = new Error("x"); const said = hc1668(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1669(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1669() { const o = new Error("x"); const said = hc1669(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1670(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1670() { const o = new Error("x"); const said = hc1670(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1671(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1671() { const o = new Error("x"); const said = hc1671(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1672(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1672() { const o = new Error("x"); const said = hc1672(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1673(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1673() { const o = new Error("x"); const said = hc1673(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1674 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1674(X) { try { new Sc1674(X); } catch (e) { return e.name; } return "changed"; }
function c1674() { const o = new Error("x"); const said = hc1674(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1674.has(o) + Sc1674.read(o); }
function hc1675(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1675() { const o = new Date(0); const said = hc1675(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1676(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1676() { const o = new Date(0); const said = hc1676(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1677(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1677() { const o = new Date(0); const said = hc1677(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1678(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1678() { const o = new Date(0); const said = hc1678(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1679(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1679() { const o = new Date(0); const said = hc1679(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1680(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1680() { const o = new Date(0); const said = hc1680(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1681(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1681() { const o = new Date(0); const said = hc1681(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1682(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1682() { const o = new Date(0); const said = hc1682(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1683(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1683() { const o = new Date(0); const said = hc1683(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1684(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1684() { const o = new Date(0); const said = hc1684(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1685(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1685() { const o = new Date(0); const said = hc1685(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1686(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1686() { const o = new Date(0); const said = hc1686(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1687(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1687() { const o = new Date(0); const said = hc1687(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1688(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1688() { const o = new Date(0); const said = hc1688(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1689(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1689() { const o = new Date(0); const said = hc1689(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1690(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1690() { const o = new Date(0); const said = hc1690(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1691(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1691() { const o = new Date(0); const said = hc1691(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1692(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1692() { const o = new Date(0); const said = hc1692(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1693(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1693() { const o = new Date(0); const said = hc1693(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1694(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1694() { const o = new Date(0); const said = hc1694(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1695(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1695() { const o = new Date(0); const said = hc1695(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1696(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1696() { const o = new Date(0); const said = hc1696(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1697(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1697() { const o = new Date(0); const said = hc1697(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1698(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1698() { const o = new Date(0); const said = hc1698(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1699 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1699(X) { try { new Sc1699(X); } catch (e) { return e.name; } return "changed"; }
function c1699() { const o = new Date(0); const said = hc1699(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1699.has(o) + Sc1699.read(o); }
function hc1700(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1700() { const o = new URL("http://a/"); const said = hc1700(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1701(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1701() { const o = new URL("http://a/"); const said = hc1701(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1702(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1702() { const o = new URL("http://a/"); const said = hc1702(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1703(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1703() { const o = new URL("http://a/"); const said = hc1703(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1704(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1704() { const o = new URL("http://a/"); const said = hc1704(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1705(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1705() { const o = new URL("http://a/"); const said = hc1705(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1706(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1706() { const o = new URL("http://a/"); const said = hc1706(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1707(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1707() { const o = new URL("http://a/"); const said = hc1707(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1708(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1708() { const o = new URL("http://a/"); const said = hc1708(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1709(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1709() { const o = new URL("http://a/"); const said = hc1709(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1710(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1710() { const o = new URL("http://a/"); const said = hc1710(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1711(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1711() { const o = new URL("http://a/"); const said = hc1711(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1712(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1712() { const o = new URL("http://a/"); const said = hc1712(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1713(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1713() { const o = new URL("http://a/"); const said = hc1713(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1714(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1714() { const o = new URL("http://a/"); const said = hc1714(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1715(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1715() { const o = new URL("http://a/"); const said = hc1715(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1716(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1716() { const o = new URL("http://a/"); const said = hc1716(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1717(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1717() { const o = new URL("http://a/"); const said = hc1717(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1718(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1718() { const o = new URL("http://a/"); const said = hc1718(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1719(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1719() { const o = new URL("http://a/"); const said = hc1719(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1720(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1720() { const o = new URL("http://a/"); const said = hc1720(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1721(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1721() { const o = new URL("http://a/"); const said = hc1721(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1722(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1722() { const o = new URL("http://a/"); const said = hc1722(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1723(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1723() { const o = new URL("http://a/"); const said = hc1723(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1724 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1724(X) { try { new Sc1724(X); } catch (e) { return e.name; } return "changed"; }
function c1724() { const o = new URL("http://a/"); const said = hc1724(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1724.has(o) + Sc1724.read(o); }
function hc1725(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1725() { const o = (function () {}).bind(null); const said = hc1725(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1726(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1726() { const o = (function () {}).bind(null); const said = hc1726(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1727(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1727() { const o = (function () {}).bind(null); const said = hc1727(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1728(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1728() { const o = (function () {}).bind(null); const said = hc1728(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1729(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1729() { const o = (function () {}).bind(null); const said = hc1729(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1730(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1730() { const o = (function () {}).bind(null); const said = hc1730(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1731(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1731() { const o = (function () {}).bind(null); const said = hc1731(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1732(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1732() { const o = (function () {}).bind(null); const said = hc1732(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1733(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1733() { const o = (function () {}).bind(null); const said = hc1733(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1734(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1734() { const o = (function () {}).bind(null); const said = hc1734(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1735(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1735() { const o = (function () {}).bind(null); const said = hc1735(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1736(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1736() { const o = (function () {}).bind(null); const said = hc1736(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1737(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1737() { const o = (function () {}).bind(null); const said = hc1737(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1738(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1738() { const o = (function () {}).bind(null); const said = hc1738(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1739(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1739() { const o = (function () {}).bind(null); const said = hc1739(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1740(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1740() { const o = (function () {}).bind(null); const said = hc1740(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1741(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1741() { const o = (function () {}).bind(null); const said = hc1741(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1742(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1742() { const o = (function () {}).bind(null); const said = hc1742(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1743(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1743() { const o = (function () {}).bind(null); const said = hc1743(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1744(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1744() { const o = (function () {}).bind(null); const said = hc1744(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1745(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1745() { const o = (function () {}).bind(null); const said = hc1745(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1746(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1746() { const o = (function () {}).bind(null); const said = hc1746(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1747(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1747() { const o = (function () {}).bind(null); const said = hc1747(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1748(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1748() { const o = (function () {}).bind(null); const said = hc1748(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1749 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1749(X) { try { new Sc1749(X); } catch (e) { return e.name; } return "changed"; }
function c1749() { const o = (function () {}).bind(null); const said = hc1749(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1749.has(o) + Sc1749.read(o); }
function hc1750(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1750() { const o = new Uint8Array(2); const said = hc1750(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1751(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1751() { const o = new Uint8Array(2); const said = hc1751(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1752(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1752() { const o = new Uint8Array(2); const said = hc1752(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1753(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1753() { const o = new Uint8Array(2); const said = hc1753(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1754(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1754() { const o = new Uint8Array(2); const said = hc1754(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1755(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1755() { const o = new Uint8Array(2); const said = hc1755(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1756(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1756() { const o = new Uint8Array(2); const said = hc1756(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1757(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1757() { const o = new Uint8Array(2); const said = hc1757(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1758(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1758() { const o = new Uint8Array(2); const said = hc1758(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1759(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1759() { const o = new Uint8Array(2); const said = hc1759(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1760(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1760() { const o = new Uint8Array(2); const said = hc1760(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1761(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1761() { const o = new Uint8Array(2); const said = hc1761(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1762(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1762() { const o = new Uint8Array(2); const said = hc1762(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1763(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1763() { const o = new Uint8Array(2); const said = hc1763(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1764(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1764() { const o = new Uint8Array(2); const said = hc1764(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1765(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1765() { const o = new Uint8Array(2); const said = hc1765(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1766(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1766() { const o = new Uint8Array(2); const said = hc1766(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1767(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1767() { const o = new Uint8Array(2); const said = hc1767(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1768(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1768() { const o = new Uint8Array(2); const said = hc1768(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1769(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1769() { const o = new Uint8Array(2); const said = hc1769(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1770(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1770() { const o = new Uint8Array(2); const said = hc1770(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1771(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1771() { const o = new Uint8Array(2); const said = hc1771(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1772(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1772() { const o = new Uint8Array(2); const said = hc1772(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1773(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1773() { const o = new Uint8Array(2); const said = hc1773(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1774 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1774(X) { try { new Sc1774(X); } catch (e) { return e.name; } return "changed"; }
function c1774() { const o = new Uint8Array(2); const said = hc1774(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1774.has(o) + Sc1774.read(o); }
function hc1775(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1775() { const o = new ArrayBuffer(2); const said = hc1775(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1776(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1776() { const o = new ArrayBuffer(2); const said = hc1776(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1777(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1777() { const o = new ArrayBuffer(2); const said = hc1777(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1778(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1778() { const o = new ArrayBuffer(2); const said = hc1778(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1779(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1779() { const o = new ArrayBuffer(2); const said = hc1779(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1780(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1780() { const o = new ArrayBuffer(2); const said = hc1780(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1781(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1781() { const o = new ArrayBuffer(2); const said = hc1781(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1782(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1782() { const o = new ArrayBuffer(2); const said = hc1782(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1783(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1783() { const o = new ArrayBuffer(2); const said = hc1783(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1784(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1784() { const o = new ArrayBuffer(2); const said = hc1784(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1785(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1785() { const o = new ArrayBuffer(2); const said = hc1785(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1786(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1786() { const o = new ArrayBuffer(2); const said = hc1786(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1787(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1787() { const o = new ArrayBuffer(2); const said = hc1787(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1788(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1788() { const o = new ArrayBuffer(2); const said = hc1788(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1789(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1789() { const o = new ArrayBuffer(2); const said = hc1789(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1790(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1790() { const o = new ArrayBuffer(2); const said = hc1790(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1791(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1791() { const o = new ArrayBuffer(2); const said = hc1791(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1792(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1792() { const o = new ArrayBuffer(2); const said = hc1792(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1793(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1793() { const o = new ArrayBuffer(2); const said = hc1793(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1794(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1794() { const o = new ArrayBuffer(2); const said = hc1794(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1795(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1795() { const o = new ArrayBuffer(2); const said = hc1795(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1796(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1796() { const o = new ArrayBuffer(2); const said = hc1796(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1797(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1797() { const o = new ArrayBuffer(2); const said = hc1797(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1798(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1798() { const o = new ArrayBuffer(2); const said = hc1798(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1799 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1799(X) { try { new Sc1799(X); } catch (e) { return e.name; } return "changed"; }
function c1799() { const o = new ArrayBuffer(2); const said = hc1799(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1799.has(o) + Sc1799.read(o); }
function hc1800(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1800() { const o = new RegExp("a"); const said = hc1800(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1801(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1801() { const o = new RegExp("a"); const said = hc1801(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1802(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1802() { const o = new RegExp("a"); const said = hc1802(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1803(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1803() { const o = new RegExp("a"); const said = hc1803(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1804(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1804() { const o = new RegExp("a"); const said = hc1804(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1805(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1805() { const o = new RegExp("a"); const said = hc1805(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1806(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1806() { const o = new RegExp("a"); const said = hc1806(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1807(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1807() { const o = new RegExp("a"); const said = hc1807(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1808(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1808() { const o = new RegExp("a"); const said = hc1808(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1809(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1809() { const o = new RegExp("a"); const said = hc1809(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1810(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1810() { const o = new RegExp("a"); const said = hc1810(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1811(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1811() { const o = new RegExp("a"); const said = hc1811(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1812(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1812() { const o = new RegExp("a"); const said = hc1812(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1813(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1813() { const o = new RegExp("a"); const said = hc1813(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1814(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1814() { const o = new RegExp("a"); const said = hc1814(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1815(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1815() { const o = new RegExp("a"); const said = hc1815(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1816(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1816() { const o = new RegExp("a"); const said = hc1816(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1817(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1817() { const o = new RegExp("a"); const said = hc1817(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1818(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1818() { const o = new RegExp("a"); const said = hc1818(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1819(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1819() { const o = new RegExp("a"); const said = hc1819(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1820(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1820() { const o = new RegExp("a"); const said = hc1820(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1821(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1821() { const o = new RegExp("a"); const said = hc1821(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1822(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1822() { const o = new RegExp("a"); const said = hc1822(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1823(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1823() { const o = new RegExp("a"); const said = hc1823(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1824 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1824(X) { try { new Sc1824(X); } catch (e) { return e.name; } return "changed"; }
function c1824() { const o = new RegExp("a"); const said = hc1824(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1824.has(o) + Sc1824.read(o); }
function hc1825(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1825() { const o = process.memoryUsage(); const said = hc1825(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1826(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1826() { const o = process.memoryUsage(); const said = hc1826(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1827(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1827() { const o = process.memoryUsage(); const said = hc1827(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1828(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1828() { const o = process.memoryUsage(); const said = hc1828(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1829(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1829() { const o = process.memoryUsage(); const said = hc1829(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1830(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1830() { const o = process.memoryUsage(); const said = hc1830(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1831(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1831() { const o = process.memoryUsage(); const said = hc1831(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1832(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1832() { const o = process.memoryUsage(); const said = hc1832(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1833(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1833() { const o = process.memoryUsage(); const said = hc1833(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1834(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1834() { const o = process.memoryUsage(); const said = hc1834(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1835(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1835() { const o = process.memoryUsage(); const said = hc1835(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1836(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1836() { const o = process.memoryUsage(); const said = hc1836(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1837(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1837() { const o = process.memoryUsage(); const said = hc1837(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1838(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1838() { const o = process.memoryUsage(); const said = hc1838(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1839(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1839() { const o = process.memoryUsage(); const said = hc1839(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1840(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1840() { const o = process.memoryUsage(); const said = hc1840(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1841(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1841() { const o = process.memoryUsage(); const said = hc1841(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1842(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1842() { const o = process.memoryUsage(); const said = hc1842(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1843(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1843() { const o = process.memoryUsage(); const said = hc1843(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1844(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1844() { const o = process.memoryUsage(); const said = hc1844(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1845(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1845() { const o = process.memoryUsage(); const said = hc1845(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1846(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1846() { const o = process.memoryUsage(); const said = hc1846(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1847(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1847() { const o = process.memoryUsage(); const said = hc1847(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1848(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1848() { const o = process.memoryUsage(); const said = hc1848(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1849 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1849(X) { try { new Sc1849(X); } catch (e) { return e.name; } return "changed"; }
function c1849() { const o = process.memoryUsage(); const said = hc1849(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1849.has(o) + Sc1849.read(o); }
function hc1850(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1850() { const o = process.hrtime(); const said = hc1850(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1851(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1851() { const o = process.hrtime(); const said = hc1851(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1852(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1852() { const o = process.hrtime(); const said = hc1852(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1853(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1853() { const o = process.hrtime(); const said = hc1853(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1854(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1854() { const o = process.hrtime(); const said = hc1854(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1855(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1855() { const o = process.hrtime(); const said = hc1855(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1856(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1856() { const o = process.hrtime(); const said = hc1856(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1857(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1857() { const o = process.hrtime(); const said = hc1857(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1858(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1858() { const o = process.hrtime(); const said = hc1858(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1859(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1859() { const o = process.hrtime(); const said = hc1859(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1860(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1860() { const o = process.hrtime(); const said = hc1860(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1861(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1861() { const o = process.hrtime(); const said = hc1861(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1862(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1862() { const o = process.hrtime(); const said = hc1862(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1863(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1863() { const o = process.hrtime(); const said = hc1863(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1864(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1864() { const o = process.hrtime(); const said = hc1864(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1865(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1865() { const o = process.hrtime(); const said = hc1865(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1866(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1866() { const o = process.hrtime(); const said = hc1866(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1867(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1867() { const o = process.hrtime(); const said = hc1867(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1868(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1868() { const o = process.hrtime(); const said = hc1868(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1869(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1869() { const o = process.hrtime(); const said = hc1869(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1870(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1870() { const o = process.hrtime(); const said = hc1870(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1871(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1871() { const o = process.hrtime(); const said = hc1871(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1872(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1872() { const o = process.hrtime(); const said = hc1872(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1873(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1873() { const o = process.hrtime(); const said = hc1873(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1874 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1874(X) { try { new Sc1874(X); } catch (e) { return e.name; } return "changed"; }
function c1874() { const o = process.hrtime(); const said = hc1874(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1874.has(o) + Sc1874.read(o); }
function hc1875(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1875() { const o = new Proxy({}, {}); const said = hc1875(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1876(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1876() { const o = new Proxy({}, {}); const said = hc1876(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1877(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1877() { const o = new Proxy({}, {}); const said = hc1877(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1878(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1878() { const o = new Proxy({}, {}); const said = hc1878(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1879(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1879() { const o = new Proxy({}, {}); const said = hc1879(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1880(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1880() { const o = new Proxy({}, {}); const said = hc1880(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1881(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1881() { const o = new Proxy({}, {}); const said = hc1881(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1882(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1882() { const o = new Proxy({}, {}); const said = hc1882(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1883(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1883() { const o = new Proxy({}, {}); const said = hc1883(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1884(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1884() { const o = new Proxy({}, {}); const said = hc1884(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1885(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1885() { const o = new Proxy({}, {}); const said = hc1885(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1886(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1886() { const o = new Proxy({}, {}); const said = hc1886(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1887(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1887() { const o = new Proxy({}, {}); const said = hc1887(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1888(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1888() { const o = new Proxy({}, {}); const said = hc1888(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1889(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1889() { const o = new Proxy({}, {}); const said = hc1889(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1890(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1890() { const o = new Proxy({}, {}); const said = hc1890(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1891(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1891() { const o = new Proxy({}, {}); const said = hc1891(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1892(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1892() { const o = new Proxy({}, {}); const said = hc1892(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1893(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1893() { const o = new Proxy({}, {}); const said = hc1893(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1894(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1894() { const o = new Proxy({}, {}); const said = hc1894(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1895(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1895() { const o = new Proxy({}, {}); const said = hc1895(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1896(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1896() { const o = new Proxy({}, {}); const said = hc1896(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1897(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1897() { const o = new Proxy({}, {}); const said = hc1897(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1898(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1898() { const o = new Proxy({}, {}); const said = hc1898(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1899 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1899(X) { try { new Sc1899(X); } catch (e) { return e.name; } return "changed"; }
function c1899() { const o = new Proxy({}, {}); const said = hc1899(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1899.has(o) + Sc1899.read(o); }
function hc1900(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1900() { const o = new WeakRef({}); const said = hc1900(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1901(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1901() { const o = new WeakRef({}); const said = hc1901(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1902(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1902() { const o = new WeakRef({}); const said = hc1902(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1903(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1903() { const o = new WeakRef({}); const said = hc1903(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1904(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1904() { const o = new WeakRef({}); const said = hc1904(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1905(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1905() { const o = new WeakRef({}); const said = hc1905(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1906(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1906() { const o = new WeakRef({}); const said = hc1906(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1907(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1907() { const o = new WeakRef({}); const said = hc1907(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1908(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1908() { const o = new WeakRef({}); const said = hc1908(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1909(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1909() { const o = new WeakRef({}); const said = hc1909(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1910(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1910() { const o = new WeakRef({}); const said = hc1910(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1911(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1911() { const o = new WeakRef({}); const said = hc1911(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1912(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1912() { const o = new WeakRef({}); const said = hc1912(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1913(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1913() { const o = new WeakRef({}); const said = hc1913(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1914(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1914() { const o = new WeakRef({}); const said = hc1914(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1915(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1915() { const o = new WeakRef({}); const said = hc1915(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1916(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1916() { const o = new WeakRef({}); const said = hc1916(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1917(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1917() { const o = new WeakRef({}); const said = hc1917(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1918(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1918() { const o = new WeakRef({}); const said = hc1918(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1919(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1919() { const o = new WeakRef({}); const said = hc1919(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1920(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1920() { const o = new WeakRef({}); const said = hc1920(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1921(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1921() { const o = new WeakRef({}); const said = hc1921(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1922(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1922() { const o = new WeakRef({}); const said = hc1922(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1923(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1923() { const o = new WeakRef({}); const said = hc1923(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1924 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1924(X) { try { new Sc1924(X); } catch (e) { return e.name; } return "changed"; }
function c1924() { const o = new WeakRef({}); const said = hc1924(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1924.has(o) + Sc1924.read(o); }
function hc1925(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1925() { const o = new TextEncoder().encode("a"); const said = hc1925(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1926(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1926() { const o = new TextEncoder().encode("a"); const said = hc1926(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1927(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1927() { const o = new TextEncoder().encode("a"); const said = hc1927(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1928(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1928() { const o = new TextEncoder().encode("a"); const said = hc1928(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1929(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1929() { const o = new TextEncoder().encode("a"); const said = hc1929(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1930(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1930() { const o = new TextEncoder().encode("a"); const said = hc1930(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1931(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1931() { const o = new TextEncoder().encode("a"); const said = hc1931(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1932(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1932() { const o = new TextEncoder().encode("a"); const said = hc1932(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1933(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1933() { const o = new TextEncoder().encode("a"); const said = hc1933(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1934(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1934() { const o = new TextEncoder().encode("a"); const said = hc1934(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1935(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1935() { const o = new TextEncoder().encode("a"); const said = hc1935(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1936(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1936() { const o = new TextEncoder().encode("a"); const said = hc1936(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1937(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1937() { const o = new TextEncoder().encode("a"); const said = hc1937(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1938(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1938() { const o = new TextEncoder().encode("a"); const said = hc1938(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1939(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1939() { const o = new TextEncoder().encode("a"); const said = hc1939(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1940(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1940() { const o = new TextEncoder().encode("a"); const said = hc1940(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1941(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1941() { const o = new TextEncoder().encode("a"); const said = hc1941(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1942(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1942() { const o = new TextEncoder().encode("a"); const said = hc1942(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1943(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1943() { const o = new TextEncoder().encode("a"); const said = hc1943(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1944(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1944() { const o = new TextEncoder().encode("a"); const said = hc1944(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1945(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1945() { const o = new TextEncoder().encode("a"); const said = hc1945(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1946(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1946() { const o = new TextEncoder().encode("a"); const said = hc1946(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1947(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1947() { const o = new TextEncoder().encode("a"); const said = hc1947(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1948(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1948() { const o = new TextEncoder().encode("a"); const said = hc1948(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1949 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1949(X) { try { new Sc1949(X); } catch (e) { return e.name; } return "changed"; }
function c1949() { const o = new TextEncoder().encode("a"); const said = hc1949(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1949.has(o) + Sc1949.read(o); }
function hc1950(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1950() { const o = new Set([1]).union(new Set([2])); const said = hc1950(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1951(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1951() { const o = new Set([1]).union(new Set([2])); const said = hc1951(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1952(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1952() { const o = new Set([1]).union(new Set([2])); const said = hc1952(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1953(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1953() { const o = new Set([1]).union(new Set([2])); const said = hc1953(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1954(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1954() { const o = new Set([1]).union(new Set([2])); const said = hc1954(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1955(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1955() { const o = new Set([1]).union(new Set([2])); const said = hc1955(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1956(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1956() { const o = new Set([1]).union(new Set([2])); const said = hc1956(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1957(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1957() { const o = new Set([1]).union(new Set([2])); const said = hc1957(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1958(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1958() { const o = new Set([1]).union(new Set([2])); const said = hc1958(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1959(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1959() { const o = new Set([1]).union(new Set([2])); const said = hc1959(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1960(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1960() { const o = new Set([1]).union(new Set([2])); const said = hc1960(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1961(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1961() { const o = new Set([1]).union(new Set([2])); const said = hc1961(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1962(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1962() { const o = new Set([1]).union(new Set([2])); const said = hc1962(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1963(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1963() { const o = new Set([1]).union(new Set([2])); const said = hc1963(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1964(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1964() { const o = new Set([1]).union(new Set([2])); const said = hc1964(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1965(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1965() { const o = new Set([1]).union(new Set([2])); const said = hc1965(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1966(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1966() { const o = new Set([1]).union(new Set([2])); const said = hc1966(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1967(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1967() { const o = new Set([1]).union(new Set([2])); const said = hc1967(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1968(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1968() { const o = new Set([1]).union(new Set([2])); const said = hc1968(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1969(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1969() { const o = new Set([1]).union(new Set([2])); const said = hc1969(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1970(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1970() { const o = new Set([1]).union(new Set([2])); const said = hc1970(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1971(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1971() { const o = new Set([1]).union(new Set([2])); const said = hc1971(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1972(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1972() { const o = new Set([1]).union(new Set([2])); const said = hc1972(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1973(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1973() { const o = new Set([1]).union(new Set([2])); const said = hc1973(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1974 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1974(X) { try { new Sc1974(X); } catch (e) { return e.name; } return "changed"; }
function c1974() { const o = new Set([1]).union(new Set([2])); const said = hc1974(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1974.has(o) + Sc1974.read(o); }
function hc1975(X) { try { Object.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1975() { const o = [1].values().toArray(); const said = hc1975(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1976(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } }); } catch (e) { return e.name; } return "changed"; }
function c1976() { const o = [1].values().toArray(); const said = hc1976(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1977(X) { try { Object.defineProperty(X, "added", { set(v) {} }); } catch (e) { return e.name; } return "changed"; }
function c1977() { const o = [1].values().toArray(); const said = hc1977(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1978(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1978() { const o = [1].values().toArray(); const said = hc1978(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1979(X) { try { Object.defineProperty(X, "added", { value: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1979() { const o = [1].values().toArray(); const said = hc1979(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1980(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } }); } catch (e) { return e.name; } return "changed"; }
function c1980() { const o = [1].values().toArray(); const said = hc1980(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1981(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7); } catch (e) { return e.name; } return "changed"; }
function c1981() { const o = [1].values().toArray(); const said = hc1981(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1982(X) { try { X.added = 7; } catch (e) { return e.name; } return "changed"; }
function c1982() { const o = [1].values().toArray(); const said = hc1982(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1983(X) { try { X["add" + "ed"] = 7; } catch (e) { return e.name; } return "changed"; }
function c1983() { const o = [1].values().toArray(); const said = hc1983(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1984(X) { try { Reflect.set(X, "added", 7); } catch (e) { return e.name; } return "changed"; }
function c1984() { const o = [1].values().toArray(); const said = hc1984(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1985(X) { try { delete X.a; } catch (e) { return e.name; } return "changed"; }
function c1985() { const o = [1].values().toArray(); const said = hc1985(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1986(X) { try { delete X[0]; } catch (e) { return e.name; } return "changed"; }
function c1986() { const o = [1].values().toArray(); const said = hc1986(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1987(X) { try { Object.freeze(X); } catch (e) { return e.name; } return "changed"; }
function c1987() { const o = [1].values().toArray(); const said = hc1987(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1988(X) { try { Object.seal(X); } catch (e) { return e.name; } return "changed"; }
function c1988() { const o = [1].values().toArray(); const said = hc1988(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1989(X) { try { Object.preventExtensions(X); } catch (e) { return e.name; } return "changed"; }
function c1989() { const o = [1].values().toArray(); const said = hc1989(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1990(X) { try { X[Symbol.for("added")] = 7; } catch (e) { return e.name; } return "changed"; }
function c1990() { const o = [1].values().toArray(); const said = hc1990(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1991(X) { try { X[0] = 7; } catch (e) { return e.name; } return "changed"; }
function c1991() { const o = [1].values().toArray(); const said = hc1991(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1992(X) { try { X[1000] = 7; } catch (e) { return e.name; } return "changed"; }
function c1992() { const o = [1].values().toArray(); const said = hc1992(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1993(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true }); } catch (e) { return e.name; } return "changed"; }
function c1993() { const o = [1].values().toArray(); const said = hc1993(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1994(X) { try { X.length = 0; } catch (e) { return e.name; } return "changed"; }
function c1994() { const o = [1].values().toArray(); const said = hc1994(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1995(X) { try { Object.setPrototypeOf(X, null); } catch (e) { return e.name; } return "changed"; }
function c1995() { const o = [1].values().toArray(); const said = hc1995(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1996(X) { try { Object.setPrototypeOf(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1996() { const o = [1].values().toArray(); const said = hc1996(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1997(X) { try { X.__proto__ = { added: 7 }; } catch (e) { return e.name; } return "changed"; }
function c1997() { const o = [1].values().toArray(); const said = hc1997(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1998(X) { try { Object.assign(X, { added: 7 }); } catch (e) { return e.name; } return "changed"; }
function c1998() { const o = [1].values().toArray(); const said = hc1998(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
class Sc1999 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1999(X) { try { new Sc1999(X); } catch (e) { return e.name; } return "changed"; }
function c1999() { const o = [1].values().toArray(); const said = hc1999(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1999.has(o) + Sc1999.read(o); }
const cases = [["fromEntries-none getter", c0], ["fromEntries-none reflect-getter", c1], ["fromEntries-none setter", c2], ["fromEntries-none getter-enumerable", c3], ["fromEntries-none data", c4], ["fromEntries-none defineProperties", c5], ["fromEntries-none defineGetter", c6], ["fromEntries-none store", c7], ["fromEntries-none store-computed", c8], ["fromEntries-none reflect-set", c9], ["fromEntries-none delete", c10], ["fromEntries-none delete-index", c11], ["fromEntries-none freeze", c12], ["fromEntries-none seal", c13], ["fromEntries-none preventExtensions", c14], ["fromEntries-none symbol", c15], ["fromEntries-none index", c16], ["fromEntries-none index-far", c17], ["fromEntries-none index-getter", c18], ["fromEntries-none length", c19], ["fromEntries-none setPrototypeOf-null", c20], ["fromEntries-none setPrototypeOf-object", c21], ["fromEntries-none proto", c22], ["fromEntries-none assign", c23], ["fromEntries-none stamp", c24], ["fromEntries-one getter", c25], ["fromEntries-one reflect-getter", c26], ["fromEntries-one setter", c27], ["fromEntries-one getter-enumerable", c28], ["fromEntries-one data", c29], ["fromEntries-one defineProperties", c30], ["fromEntries-one defineGetter", c31], ["fromEntries-one store", c32], ["fromEntries-one store-computed", c33], ["fromEntries-one reflect-set", c34], ["fromEntries-one delete", c35], ["fromEntries-one delete-index", c36], ["fromEntries-one freeze", c37], ["fromEntries-one seal", c38], ["fromEntries-one preventExtensions", c39], ["fromEntries-one symbol", c40], ["fromEntries-one index", c41], ["fromEntries-one index-far", c42], ["fromEntries-one index-getter", c43], ["fromEntries-one length", c44], ["fromEntries-one setPrototypeOf-null", c45], ["fromEntries-one setPrototypeOf-object", c46], ["fromEntries-one proto", c47], ["fromEntries-one assign", c48], ["fromEntries-one stamp", c49], ["fromEntries-map getter", c50], ["fromEntries-map reflect-getter", c51], ["fromEntries-map setter", c52], ["fromEntries-map getter-enumerable", c53], ["fromEntries-map data", c54], ["fromEntries-map defineProperties", c55], ["fromEntries-map defineGetter", c56], ["fromEntries-map store", c57], ["fromEntries-map store-computed", c58], ["fromEntries-map reflect-set", c59], ["fromEntries-map delete", c60], ["fromEntries-map delete-index", c61], ["fromEntries-map freeze", c62], ["fromEntries-map seal", c63], ["fromEntries-map preventExtensions", c64], ["fromEntries-map symbol", c65], ["fromEntries-map index", c66], ["fromEntries-map index-far", c67], ["fromEntries-map index-getter", c68], ["fromEntries-map length", c69], ["fromEntries-map setPrototypeOf-null", c70], ["fromEntries-map setPrototypeOf-object", c71], ["fromEntries-map proto", c72], ["fromEntries-map assign", c73], ["fromEntries-map stamp", c74], ["groupBy-none getter", c75], ["groupBy-none reflect-getter", c76], ["groupBy-none setter", c77], ["groupBy-none getter-enumerable", c78], ["groupBy-none data", c79], ["groupBy-none defineProperties", c80], ["groupBy-none defineGetter", c81], ["groupBy-none store", c82], ["groupBy-none store-computed", c83], ["groupBy-none reflect-set", c84], ["groupBy-none delete", c85], ["groupBy-none delete-index", c86], ["groupBy-none freeze", c87], ["groupBy-none seal", c88], ["groupBy-none preventExtensions", c89], ["groupBy-none symbol", c90], ["groupBy-none index", c91], ["groupBy-none index-far", c92], ["groupBy-none index-getter", c93], ["groupBy-none length", c94], ["groupBy-none setPrototypeOf-null", c95], ["groupBy-none setPrototypeOf-object", c96], ["groupBy-none proto", c97], ["groupBy-none assign", c98], ["groupBy-none stamp", c99], ["groupBy-one getter", c100], ["groupBy-one reflect-getter", c101], ["groupBy-one setter", c102], ["groupBy-one getter-enumerable", c103], ["groupBy-one data", c104], ["groupBy-one defineProperties", c105], ["groupBy-one defineGetter", c106], ["groupBy-one store", c107], ["groupBy-one store-computed", c108], ["groupBy-one reflect-set", c109], ["groupBy-one delete", c110], ["groupBy-one delete-index", c111], ["groupBy-one freeze", c112], ["groupBy-one seal", c113], ["groupBy-one preventExtensions", c114], ["groupBy-one symbol", c115], ["groupBy-one index", c116], ["groupBy-one index-far", c117], ["groupBy-one index-getter", c118], ["groupBy-one length", c119], ["groupBy-one setPrototypeOf-null", c120], ["groupBy-one setPrototypeOf-object", c121], ["groupBy-one proto", c122], ["groupBy-one assign", c123], ["groupBy-one stamp", c124], ["Map.groupBy getter", c125], ["Map.groupBy reflect-getter", c126], ["Map.groupBy setter", c127], ["Map.groupBy getter-enumerable", c128], ["Map.groupBy data", c129], ["Map.groupBy defineProperties", c130], ["Map.groupBy defineGetter", c131], ["Map.groupBy store", c132], ["Map.groupBy store-computed", c133], ["Map.groupBy reflect-set", c134], ["Map.groupBy delete", c135], ["Map.groupBy delete-index", c136], ["Map.groupBy freeze", c137], ["Map.groupBy seal", c138], ["Map.groupBy preventExtensions", c139], ["Map.groupBy symbol", c140], ["Map.groupBy index", c141], ["Map.groupBy index-far", c142], ["Map.groupBy index-getter", c143], ["Map.groupBy length", c144], ["Map.groupBy setPrototypeOf-null", c145], ["Map.groupBy setPrototypeOf-object", c146], ["Map.groupBy proto", c147], ["Map.groupBy assign", c148], ["Map.groupBy stamp", c149], ["create-null getter", c150], ["create-null reflect-getter", c151], ["create-null setter", c152], ["create-null getter-enumerable", c153], ["create-null data", c154], ["create-null defineProperties", c155], ["create-null defineGetter", c156], ["create-null store", c157], ["create-null store-computed", c158], ["create-null reflect-set", c159], ["create-null delete", c160], ["create-null delete-index", c161], ["create-null freeze", c162], ["create-null seal", c163], ["create-null preventExtensions", c164], ["create-null symbol", c165], ["create-null index", c166], ["create-null index-far", c167], ["create-null index-getter", c168], ["create-null length", c169], ["create-null setPrototypeOf-null", c170], ["create-null setPrototypeOf-object", c171], ["create-null proto", c172], ["create-null assign", c173], ["create-null stamp", c174], ["create-object getter", c175], ["create-object reflect-getter", c176], ["create-object setter", c177], ["create-object getter-enumerable", c178], ["create-object data", c179], ["create-object defineProperties", c180], ["create-object defineGetter", c181], ["create-object store", c182], ["create-object store-computed", c183], ["create-object reflect-set", c184], ["create-object delete", c185], ["create-object delete-index", c186], ["create-object freeze", c187], ["create-object seal", c188], ["create-object preventExtensions", c189], ["create-object symbol", c190], ["create-object index", c191], ["create-object index-far", c192], ["create-object index-getter", c193], ["create-object length", c194], ["create-object setPrototypeOf-null", c195], ["create-object setPrototypeOf-object", c196], ["create-object proto", c197], ["create-object assign", c198], ["create-object stamp", c199], ["create-prototype getter", c200], ["create-prototype reflect-getter", c201], ["create-prototype setter", c202], ["create-prototype getter-enumerable", c203], ["create-prototype data", c204], ["create-prototype defineProperties", c205], ["create-prototype defineGetter", c206], ["create-prototype store", c207], ["create-prototype store-computed", c208], ["create-prototype reflect-set", c209], ["create-prototype delete", c210], ["create-prototype delete-index", c211], ["create-prototype freeze", c212], ["create-prototype seal", c213], ["create-prototype preventExtensions", c214], ["create-prototype symbol", c215], ["create-prototype index", c216], ["create-prototype index-far", c217], ["create-prototype index-getter", c218], ["create-prototype length", c219], ["create-prototype setPrototypeOf-null", c220], ["create-prototype setPrototypeOf-object", c221], ["create-prototype proto", c222], ["create-prototype assign", c223], ["create-prototype stamp", c224], ["create-descriptors getter", c225], ["create-descriptors reflect-getter", c226], ["create-descriptors setter", c227], ["create-descriptors getter-enumerable", c228], ["create-descriptors data", c229], ["create-descriptors defineProperties", c230], ["create-descriptors defineGetter", c231], ["create-descriptors store", c232], ["create-descriptors store-computed", c233], ["create-descriptors reflect-set", c234], ["create-descriptors delete", c235], ["create-descriptors delete-index", c236], ["create-descriptors freeze", c237], ["create-descriptors seal", c238], ["create-descriptors preventExtensions", c239], ["create-descriptors symbol", c240], ["create-descriptors index", c241], ["create-descriptors index-far", c242], ["create-descriptors index-getter", c243], ["create-descriptors length", c244], ["create-descriptors setPrototypeOf-null", c245], ["create-descriptors setPrototypeOf-object", c246], ["create-descriptors proto", c247], ["create-descriptors assign", c248], ["create-descriptors stamp", c249], ["assign getter", c250], ["assign reflect-getter", c251], ["assign setter", c252], ["assign getter-enumerable", c253], ["assign data", c254], ["assign defineProperties", c255], ["assign defineGetter", c256], ["assign store", c257], ["assign store-computed", c258], ["assign reflect-set", c259], ["assign delete", c260], ["assign delete-index", c261], ["assign freeze", c262], ["assign seal", c263], ["assign preventExtensions", c264], ["assign symbol", c265], ["assign index", c266], ["assign index-far", c267], ["assign index-getter", c268], ["assign length", c269], ["assign setPrototypeOf-null", c270], ["assign setPrototypeOf-object", c271], ["assign proto", c272], ["assign assign", c273], ["assign stamp", c274], ["structuredClone getter", c275], ["structuredClone reflect-getter", c276], ["structuredClone setter", c277], ["structuredClone getter-enumerable", c278], ["structuredClone data", c279], ["structuredClone defineProperties", c280], ["structuredClone defineGetter", c281], ["structuredClone store", c282], ["structuredClone store-computed", c283], ["structuredClone reflect-set", c284], ["structuredClone delete", c285], ["structuredClone delete-index", c286], ["structuredClone freeze", c287], ["structuredClone seal", c288], ["structuredClone preventExtensions", c289], ["structuredClone symbol", c290], ["structuredClone index", c291], ["structuredClone index-far", c292], ["structuredClone index-getter", c293], ["structuredClone length", c294], ["structuredClone setPrototypeOf-null", c295], ["structuredClone setPrototypeOf-object", c296], ["structuredClone proto", c297], ["structuredClone assign", c298], ["structuredClone stamp", c299], ["structuredClone-array getter", c300], ["structuredClone-array reflect-getter", c301], ["structuredClone-array setter", c302], ["structuredClone-array getter-enumerable", c303], ["structuredClone-array data", c304], ["structuredClone-array defineProperties", c305], ["structuredClone-array defineGetter", c306], ["structuredClone-array store", c307], ["structuredClone-array store-computed", c308], ["structuredClone-array reflect-set", c309], ["structuredClone-array delete", c310], ["structuredClone-array delete-index", c311], ["structuredClone-array freeze", c312], ["structuredClone-array seal", c313], ["structuredClone-array preventExtensions", c314], ["structuredClone-array symbol", c315], ["structuredClone-array index", c316], ["structuredClone-array index-far", c317], ["structuredClone-array index-getter", c318], ["structuredClone-array length", c319], ["structuredClone-array setPrototypeOf-null", c320], ["structuredClone-array setPrototypeOf-object", c321], ["structuredClone-array proto", c322], ["structuredClone-array assign", c323], ["structuredClone-array stamp", c324], ["JSON.parse getter", c325], ["JSON.parse reflect-getter", c326], ["JSON.parse setter", c327], ["JSON.parse getter-enumerable", c328], ["JSON.parse data", c329], ["JSON.parse defineProperties", c330], ["JSON.parse defineGetter", c331], ["JSON.parse store", c332], ["JSON.parse store-computed", c333], ["JSON.parse reflect-set", c334], ["JSON.parse delete", c335], ["JSON.parse delete-index", c336], ["JSON.parse freeze", c337], ["JSON.parse seal", c338], ["JSON.parse preventExtensions", c339], ["JSON.parse symbol", c340], ["JSON.parse index", c341], ["JSON.parse index-far", c342], ["JSON.parse index-getter", c343], ["JSON.parse length", c344], ["JSON.parse setPrototypeOf-null", c345], ["JSON.parse setPrototypeOf-object", c346], ["JSON.parse proto", c347], ["JSON.parse assign", c348], ["JSON.parse stamp", c349], ["JSON.parse-array getter", c350], ["JSON.parse-array reflect-getter", c351], ["JSON.parse-array setter", c352], ["JSON.parse-array getter-enumerable", c353], ["JSON.parse-array data", c354], ["JSON.parse-array defineProperties", c355], ["JSON.parse-array defineGetter", c356], ["JSON.parse-array store", c357], ["JSON.parse-array store-computed", c358], ["JSON.parse-array reflect-set", c359], ["JSON.parse-array delete", c360], ["JSON.parse-array delete-index", c361], ["JSON.parse-array freeze", c362], ["JSON.parse-array seal", c363], ["JSON.parse-array preventExtensions", c364], ["JSON.parse-array symbol", c365], ["JSON.parse-array index", c366], ["JSON.parse-array index-far", c367], ["JSON.parse-array index-getter", c368], ["JSON.parse-array length", c369], ["JSON.parse-array setPrototypeOf-null", c370], ["JSON.parse-array setPrototypeOf-object", c371], ["JSON.parse-array proto", c372], ["JSON.parse-array assign", c373], ["JSON.parse-array stamp", c374], ["Array.from getter", c375], ["Array.from reflect-getter", c376], ["Array.from setter", c377], ["Array.from getter-enumerable", c378], ["Array.from data", c379], ["Array.from defineProperties", c380], ["Array.from defineGetter", c381], ["Array.from store", c382], ["Array.from store-computed", c383], ["Array.from reflect-set", c384], ["Array.from delete", c385], ["Array.from delete-index", c386], ["Array.from freeze", c387], ["Array.from seal", c388], ["Array.from preventExtensions", c389], ["Array.from symbol", c390], ["Array.from index", c391], ["Array.from index-far", c392], ["Array.from index-getter", c393], ["Array.from length", c394], ["Array.from setPrototypeOf-null", c395], ["Array.from setPrototypeOf-object", c396], ["Array.from proto", c397], ["Array.from assign", c398], ["Array.from stamp", c399], ["Array.from-like getter", c400], ["Array.from-like reflect-getter", c401], ["Array.from-like setter", c402], ["Array.from-like getter-enumerable", c403], ["Array.from-like data", c404], ["Array.from-like defineProperties", c405], ["Array.from-like defineGetter", c406], ["Array.from-like store", c407], ["Array.from-like store-computed", c408], ["Array.from-like reflect-set", c409], ["Array.from-like delete", c410], ["Array.from-like delete-index", c411], ["Array.from-like freeze", c412], ["Array.from-like seal", c413], ["Array.from-like preventExtensions", c414], ["Array.from-like symbol", c415], ["Array.from-like index", c416], ["Array.from-like index-far", c417], ["Array.from-like index-getter", c418], ["Array.from-like length", c419], ["Array.from-like setPrototypeOf-null", c420], ["Array.from-like setPrototypeOf-object", c421], ["Array.from-like proto", c422], ["Array.from-like assign", c423], ["Array.from-like stamp", c424], ["Array.of getter", c425], ["Array.of reflect-getter", c426], ["Array.of setter", c427], ["Array.of getter-enumerable", c428], ["Array.of data", c429], ["Array.of defineProperties", c430], ["Array.of defineGetter", c431], ["Array.of store", c432], ["Array.of store-computed", c433], ["Array.of reflect-set", c434], ["Array.of delete", c435], ["Array.of delete-index", c436], ["Array.of freeze", c437], ["Array.of seal", c438], ["Array.of preventExtensions", c439], ["Array.of symbol", c440], ["Array.of index", c441], ["Array.of index-far", c442], ["Array.of index-getter", c443], ["Array.of length", c444], ["Array.of setPrototypeOf-null", c445], ["Array.of setPrototypeOf-object", c446], ["Array.of proto", c447], ["Array.of assign", c448], ["Array.of stamp", c449], ["new-Array getter", c450], ["new-Array reflect-getter", c451], ["new-Array setter", c452], ["new-Array getter-enumerable", c453], ["new-Array data", c454], ["new-Array defineProperties", c455], ["new-Array defineGetter", c456], ["new-Array store", c457], ["new-Array store-computed", c458], ["new-Array reflect-set", c459], ["new-Array delete", c460], ["new-Array delete-index", c461], ["new-Array freeze", c462], ["new-Array seal", c463], ["new-Array preventExtensions", c464], ["new-Array symbol", c465], ["new-Array index", c466], ["new-Array index-far", c467], ["new-Array index-getter", c468], ["new-Array length", c469], ["new-Array setPrototypeOf-null", c470], ["new-Array setPrototypeOf-object", c471], ["new-Array proto", c472], ["new-Array assign", c473], ["new-Array stamp", c474], ["Array-call getter", c475], ["Array-call reflect-getter", c476], ["Array-call setter", c477], ["Array-call getter-enumerable", c478], ["Array-call data", c479], ["Array-call defineProperties", c480], ["Array-call defineGetter", c481], ["Array-call store", c482], ["Array-call store-computed", c483], ["Array-call reflect-set", c484], ["Array-call delete", c485], ["Array-call delete-index", c486], ["Array-call freeze", c487], ["Array-call seal", c488], ["Array-call preventExtensions", c489], ["Array-call symbol", c490], ["Array-call index", c491], ["Array-call index-far", c492], ["Array-call index-getter", c493], ["Array-call length", c494], ["Array-call setPrototypeOf-null", c495], ["Array-call setPrototypeOf-object", c496], ["Array-call proto", c497], ["Array-call assign", c498], ["Array-call stamp", c499], ["entries getter", c500], ["entries reflect-getter", c501], ["entries setter", c502], ["entries getter-enumerable", c503], ["entries data", c504], ["entries defineProperties", c505], ["entries defineGetter", c506], ["entries store", c507], ["entries store-computed", c508], ["entries reflect-set", c509], ["entries delete", c510], ["entries delete-index", c511], ["entries freeze", c512], ["entries seal", c513], ["entries preventExtensions", c514], ["entries symbol", c515], ["entries index", c516], ["entries index-far", c517], ["entries index-getter", c518], ["entries length", c519], ["entries setPrototypeOf-null", c520], ["entries setPrototypeOf-object", c521], ["entries proto", c522], ["entries assign", c523], ["entries stamp", c524], ["entries-pair getter", c525], ["entries-pair reflect-getter", c526], ["entries-pair setter", c527], ["entries-pair getter-enumerable", c528], ["entries-pair data", c529], ["entries-pair defineProperties", c530], ["entries-pair defineGetter", c531], ["entries-pair store", c532], ["entries-pair store-computed", c533], ["entries-pair reflect-set", c534], ["entries-pair delete", c535], ["entries-pair delete-index", c536], ["entries-pair freeze", c537], ["entries-pair seal", c538], ["entries-pair preventExtensions", c539], ["entries-pair symbol", c540], ["entries-pair index", c541], ["entries-pair index-far", c542], ["entries-pair index-getter", c543], ["entries-pair length", c544], ["entries-pair setPrototypeOf-null", c545], ["entries-pair setPrototypeOf-object", c546], ["entries-pair proto", c547], ["entries-pair assign", c548], ["entries-pair stamp", c549], ["values getter", c550], ["values reflect-getter", c551], ["values setter", c552], ["values getter-enumerable", c553], ["values data", c554], ["values defineProperties", c555], ["values defineGetter", c556], ["values store", c557], ["values store-computed", c558], ["values reflect-set", c559], ["values delete", c560], ["values delete-index", c561], ["values freeze", c562], ["values seal", c563], ["values preventExtensions", c564], ["values symbol", c565], ["values index", c566], ["values index-far", c567], ["values index-getter", c568], ["values length", c569], ["values setPrototypeOf-null", c570], ["values setPrototypeOf-object", c571], ["values proto", c572], ["values assign", c573], ["values stamp", c574], ["keys getter", c575], ["keys reflect-getter", c576], ["keys setter", c577], ["keys getter-enumerable", c578], ["keys data", c579], ["keys defineProperties", c580], ["keys defineGetter", c581], ["keys store", c582], ["keys store-computed", c583], ["keys reflect-set", c584], ["keys delete", c585], ["keys delete-index", c586], ["keys freeze", c587], ["keys seal", c588], ["keys preventExtensions", c589], ["keys symbol", c590], ["keys index", c591], ["keys index-far", c592], ["keys index-getter", c593], ["keys length", c594], ["keys setPrototypeOf-null", c595], ["keys setPrototypeOf-object", c596], ["keys proto", c597], ["keys assign", c598], ["keys stamp", c599], ["ownKeys getter", c600], ["ownKeys reflect-getter", c601], ["ownKeys setter", c602], ["ownKeys getter-enumerable", c603], ["ownKeys data", c604], ["ownKeys defineProperties", c605], ["ownKeys defineGetter", c606], ["ownKeys store", c607], ["ownKeys store-computed", c608], ["ownKeys reflect-set", c609], ["ownKeys delete", c610], ["ownKeys delete-index", c611], ["ownKeys freeze", c612], ["ownKeys seal", c613], ["ownKeys preventExtensions", c614], ["ownKeys symbol", c615], ["ownKeys index", c616], ["ownKeys index-far", c617], ["ownKeys index-getter", c618], ["ownKeys length", c619], ["ownKeys setPrototypeOf-null", c620], ["ownKeys setPrototypeOf-object", c621], ["ownKeys proto", c622], ["ownKeys assign", c623], ["ownKeys stamp", c624], ["getOwnPropertyNames getter", c625], ["getOwnPropertyNames reflect-getter", c626], ["getOwnPropertyNames setter", c627], ["getOwnPropertyNames getter-enumerable", c628], ["getOwnPropertyNames data", c629], ["getOwnPropertyNames defineProperties", c630], ["getOwnPropertyNames defineGetter", c631], ["getOwnPropertyNames store", c632], ["getOwnPropertyNames store-computed", c633], ["getOwnPropertyNames reflect-set", c634], ["getOwnPropertyNames delete", c635], ["getOwnPropertyNames delete-index", c636], ["getOwnPropertyNames freeze", c637], ["getOwnPropertyNames seal", c638], ["getOwnPropertyNames preventExtensions", c639], ["getOwnPropertyNames symbol", c640], ["getOwnPropertyNames index", c641], ["getOwnPropertyNames index-far", c642], ["getOwnPropertyNames index-getter", c643], ["getOwnPropertyNames length", c644], ["getOwnPropertyNames setPrototypeOf-null", c645], ["getOwnPropertyNames setPrototypeOf-object", c646], ["getOwnPropertyNames proto", c647], ["getOwnPropertyNames assign", c648], ["getOwnPropertyNames stamp", c649], ["descriptor getter", c650], ["descriptor reflect-getter", c651], ["descriptor setter", c652], ["descriptor getter-enumerable", c653], ["descriptor data", c654], ["descriptor defineProperties", c655], ["descriptor defineGetter", c656], ["descriptor store", c657], ["descriptor store-computed", c658], ["descriptor reflect-set", c659], ["descriptor delete", c660], ["descriptor delete-index", c661], ["descriptor freeze", c662], ["descriptor seal", c663], ["descriptor preventExtensions", c664], ["descriptor symbol", c665], ["descriptor index", c666], ["descriptor index-far", c667], ["descriptor index-getter", c668], ["descriptor length", c669], ["descriptor setPrototypeOf-null", c670], ["descriptor setPrototypeOf-object", c671], ["descriptor proto", c672], ["descriptor assign", c673], ["descriptor stamp", c674], ["descriptors getter", c675], ["descriptors reflect-getter", c676], ["descriptors setter", c677], ["descriptors getter-enumerable", c678], ["descriptors data", c679], ["descriptors defineProperties", c680], ["descriptors defineGetter", c681], ["descriptors store", c682], ["descriptors store-computed", c683], ["descriptors reflect-set", c684], ["descriptors delete", c685], ["descriptors delete-index", c686], ["descriptors freeze", c687], ["descriptors seal", c688], ["descriptors preventExtensions", c689], ["descriptors symbol", c690], ["descriptors index", c691], ["descriptors index-far", c692], ["descriptors index-getter", c693], ["descriptors length", c694], ["descriptors setPrototypeOf-null", c695], ["descriptors setPrototypeOf-object", c696], ["descriptors proto", c697], ["descriptors assign", c698], ["descriptors stamp", c699], ["reflect-descriptor getter", c700], ["reflect-descriptor reflect-getter", c701], ["reflect-descriptor setter", c702], ["reflect-descriptor getter-enumerable", c703], ["reflect-descriptor data", c704], ["reflect-descriptor defineProperties", c705], ["reflect-descriptor defineGetter", c706], ["reflect-descriptor store", c707], ["reflect-descriptor store-computed", c708], ["reflect-descriptor reflect-set", c709], ["reflect-descriptor delete", c710], ["reflect-descriptor delete-index", c711], ["reflect-descriptor freeze", c712], ["reflect-descriptor seal", c713], ["reflect-descriptor preventExtensions", c714], ["reflect-descriptor symbol", c715], ["reflect-descriptor index", c716], ["reflect-descriptor index-far", c717], ["reflect-descriptor index-getter", c718], ["reflect-descriptor length", c719], ["reflect-descriptor setPrototypeOf-null", c720], ["reflect-descriptor setPrototypeOf-object", c721], ["reflect-descriptor proto", c722], ["reflect-descriptor assign", c723], ["reflect-descriptor stamp", c724], ["iterator-result getter", c725], ["iterator-result reflect-getter", c726], ["iterator-result setter", c727], ["iterator-result getter-enumerable", c728], ["iterator-result data", c729], ["iterator-result defineProperties", c730], ["iterator-result defineGetter", c731], ["iterator-result store", c732], ["iterator-result store-computed", c733], ["iterator-result reflect-set", c734], ["iterator-result delete", c735], ["iterator-result delete-index", c736], ["iterator-result freeze", c737], ["iterator-result seal", c738], ["iterator-result preventExtensions", c739], ["iterator-result symbol", c740], ["iterator-result index", c741], ["iterator-result index-far", c742], ["iterator-result index-getter", c743], ["iterator-result length", c744], ["iterator-result setPrototypeOf-null", c745], ["iterator-result setPrototypeOf-object", c746], ["iterator-result proto", c747], ["iterator-result assign", c748], ["iterator-result stamp", c749], ["entries-result getter", c750], ["entries-result reflect-getter", c751], ["entries-result setter", c752], ["entries-result getter-enumerable", c753], ["entries-result data", c754], ["entries-result defineProperties", c755], ["entries-result defineGetter", c756], ["entries-result store", c757], ["entries-result store-computed", c758], ["entries-result reflect-set", c759], ["entries-result delete", c760], ["entries-result delete-index", c761], ["entries-result freeze", c762], ["entries-result seal", c763], ["entries-result preventExtensions", c764], ["entries-result symbol", c765], ["entries-result index", c766], ["entries-result index-far", c767], ["entries-result index-getter", c768], ["entries-result length", c769], ["entries-result setPrototypeOf-null", c770], ["entries-result setPrototypeOf-object", c771], ["entries-result proto", c772], ["entries-result assign", c773], ["entries-result stamp", c774], ["map-entry getter", c775], ["map-entry reflect-getter", c776], ["map-entry setter", c777], ["map-entry getter-enumerable", c778], ["map-entry data", c779], ["map-entry defineProperties", c780], ["map-entry defineGetter", c781], ["map-entry store", c782], ["map-entry store-computed", c783], ["map-entry reflect-set", c784], ["map-entry delete", c785], ["map-entry delete-index", c786], ["map-entry freeze", c787], ["map-entry seal", c788], ["map-entry preventExtensions", c789], ["map-entry symbol", c790], ["map-entry index", c791], ["map-entry index-far", c792], ["map-entry index-getter", c793], ["map-entry length", c794], ["map-entry setPrototypeOf-null", c795], ["map-entry setPrototypeOf-object", c796], ["map-entry proto", c797], ["map-entry assign", c798], ["map-entry stamp", c799], ["generator-result getter", c800], ["generator-result reflect-getter", c801], ["generator-result setter", c802], ["generator-result getter-enumerable", c803], ["generator-result data", c804], ["generator-result defineProperties", c805], ["generator-result defineGetter", c806], ["generator-result store", c807], ["generator-result store-computed", c808], ["generator-result reflect-set", c809], ["generator-result delete", c810], ["generator-result delete-index", c811], ["generator-result freeze", c812], ["generator-result seal", c813], ["generator-result preventExtensions", c814], ["generator-result symbol", c815], ["generator-result index", c816], ["generator-result index-far", c817], ["generator-result index-getter", c818], ["generator-result length", c819], ["generator-result setPrototypeOf-null", c820], ["generator-result setPrototypeOf-object", c821], ["generator-result proto", c822], ["generator-result assign", c823], ["generator-result stamp", c824], ["match getter", c825], ["match reflect-getter", c826], ["match setter", c827], ["match getter-enumerable", c828], ["match data", c829], ["match defineProperties", c830], ["match defineGetter", c831], ["match store", c832], ["match store-computed", c833], ["match reflect-set", c834], ["match delete", c835], ["match delete-index", c836], ["match freeze", c837], ["match seal", c838], ["match preventExtensions", c839], ["match symbol", c840], ["match index", c841], ["match index-far", c842], ["match index-getter", c843], ["match length", c844], ["match setPrototypeOf-null", c845], ["match setPrototypeOf-object", c846], ["match proto", c847], ["match assign", c848], ["match stamp", c849], ["match-groups getter", c850], ["match-groups reflect-getter", c851], ["match-groups setter", c852], ["match-groups getter-enumerable", c853], ["match-groups data", c854], ["match-groups defineProperties", c855], ["match-groups defineGetter", c856], ["match-groups store", c857], ["match-groups store-computed", c858], ["match-groups reflect-set", c859], ["match-groups delete", c860], ["match-groups delete-index", c861], ["match-groups freeze", c862], ["match-groups seal", c863], ["match-groups preventExtensions", c864], ["match-groups symbol", c865], ["match-groups index", c866], ["match-groups index-far", c867], ["match-groups index-getter", c868], ["match-groups length", c869], ["match-groups setPrototypeOf-null", c870], ["match-groups setPrototypeOf-object", c871], ["match-groups proto", c872], ["match-groups assign", c873], ["match-groups stamp", c874], ["match-global getter", c875], ["match-global reflect-getter", c876], ["match-global setter", c877], ["match-global getter-enumerable", c878], ["match-global data", c879], ["match-global defineProperties", c880], ["match-global defineGetter", c881], ["match-global store", c882], ["match-global store-computed", c883], ["match-global reflect-set", c884], ["match-global delete", c885], ["match-global delete-index", c886], ["match-global freeze", c887], ["match-global seal", c888], ["match-global preventExtensions", c889], ["match-global symbol", c890], ["match-global index", c891], ["match-global index-far", c892], ["match-global index-getter", c893], ["match-global length", c894], ["match-global setPrototypeOf-null", c895], ["match-global setPrototypeOf-object", c896], ["match-global proto", c897], ["match-global assign", c898], ["match-global stamp", c899], ["matchAll getter", c900], ["matchAll reflect-getter", c901], ["matchAll setter", c902], ["matchAll getter-enumerable", c903], ["matchAll data", c904], ["matchAll defineProperties", c905], ["matchAll defineGetter", c906], ["matchAll store", c907], ["matchAll store-computed", c908], ["matchAll reflect-set", c909], ["matchAll delete", c910], ["matchAll delete-index", c911], ["matchAll freeze", c912], ["matchAll seal", c913], ["matchAll preventExtensions", c914], ["matchAll symbol", c915], ["matchAll index", c916], ["matchAll index-far", c917], ["matchAll index-getter", c918], ["matchAll length", c919], ["matchAll setPrototypeOf-null", c920], ["matchAll setPrototypeOf-object", c921], ["matchAll proto", c922], ["matchAll assign", c923], ["matchAll stamp", c924], ["exec getter", c925], ["exec reflect-getter", c926], ["exec setter", c927], ["exec getter-enumerable", c928], ["exec data", c929], ["exec defineProperties", c930], ["exec defineGetter", c931], ["exec store", c932], ["exec store-computed", c933], ["exec reflect-set", c934], ["exec delete", c935], ["exec delete-index", c936], ["exec freeze", c937], ["exec seal", c938], ["exec preventExtensions", c939], ["exec symbol", c940], ["exec index", c941], ["exec index-far", c942], ["exec index-getter", c943], ["exec length", c944], ["exec setPrototypeOf-null", c945], ["exec setPrototypeOf-object", c946], ["exec proto", c947], ["exec assign", c948], ["exec stamp", c949], ["exec-indices getter", c950], ["exec-indices reflect-getter", c951], ["exec-indices setter", c952], ["exec-indices getter-enumerable", c953], ["exec-indices data", c954], ["exec-indices defineProperties", c955], ["exec-indices defineGetter", c956], ["exec-indices store", c957], ["exec-indices store-computed", c958], ["exec-indices reflect-set", c959], ["exec-indices delete", c960], ["exec-indices delete-index", c961], ["exec-indices freeze", c962], ["exec-indices seal", c963], ["exec-indices preventExtensions", c964], ["exec-indices symbol", c965], ["exec-indices index", c966], ["exec-indices index-far", c967], ["exec-indices index-getter", c968], ["exec-indices length", c969], ["exec-indices setPrototypeOf-null", c970], ["exec-indices setPrototypeOf-object", c971], ["exec-indices proto", c972], ["exec-indices assign", c973], ["exec-indices stamp", c974], ["split getter", c975], ["split reflect-getter", c976], ["split setter", c977], ["split getter-enumerable", c978], ["split data", c979], ["split defineProperties", c980], ["split defineGetter", c981], ["split store", c982], ["split store-computed", c983], ["split reflect-set", c984], ["split delete", c985], ["split delete-index", c986], ["split freeze", c987], ["split seal", c988], ["split preventExtensions", c989], ["split symbol", c990], ["split index", c991], ["split index-far", c992], ["split index-getter", c993], ["split length", c994], ["split setPrototypeOf-null", c995], ["split setPrototypeOf-object", c996], ["split proto", c997], ["split assign", c998], ["split stamp", c999], ["number-format-options getter", c1000], ["number-format-options reflect-getter", c1001], ["number-format-options setter", c1002], ["number-format-options getter-enumerable", c1003], ["number-format-options data", c1004], ["number-format-options defineProperties", c1005], ["number-format-options defineGetter", c1006], ["number-format-options store", c1007], ["number-format-options store-computed", c1008], ["number-format-options reflect-set", c1009], ["number-format-options delete", c1010], ["number-format-options delete-index", c1011], ["number-format-options freeze", c1012], ["number-format-options seal", c1013], ["number-format-options preventExtensions", c1014], ["number-format-options symbol", c1015], ["number-format-options index", c1016], ["number-format-options index-far", c1017], ["number-format-options index-getter", c1018], ["number-format-options length", c1019], ["number-format-options setPrototypeOf-null", c1020], ["number-format-options setPrototypeOf-object", c1021], ["number-format-options proto", c1022], ["number-format-options assign", c1023], ["number-format-options stamp", c1024], ["date-format-options getter", c1025], ["date-format-options reflect-getter", c1026], ["date-format-options setter", c1027], ["date-format-options getter-enumerable", c1028], ["date-format-options data", c1029], ["date-format-options defineProperties", c1030], ["date-format-options defineGetter", c1031], ["date-format-options store", c1032], ["date-format-options store-computed", c1033], ["date-format-options reflect-set", c1034], ["date-format-options delete", c1035], ["date-format-options delete-index", c1036], ["date-format-options freeze", c1037], ["date-format-options seal", c1038], ["date-format-options preventExtensions", c1039], ["date-format-options symbol", c1040], ["date-format-options index", c1041], ["date-format-options index-far", c1042], ["date-format-options index-getter", c1043], ["date-format-options length", c1044], ["date-format-options setPrototypeOf-null", c1045], ["date-format-options setPrototypeOf-object", c1046], ["date-format-options proto", c1047], ["date-format-options assign", c1048], ["date-format-options stamp", c1049], ["format-parts getter", c1050], ["format-parts reflect-getter", c1051], ["format-parts setter", c1052], ["format-parts getter-enumerable", c1053], ["format-parts data", c1054], ["format-parts defineProperties", c1055], ["format-parts defineGetter", c1056], ["format-parts store", c1057], ["format-parts store-computed", c1058], ["format-parts reflect-set", c1059], ["format-parts delete", c1060], ["format-parts delete-index", c1061], ["format-parts freeze", c1062], ["format-parts seal", c1063], ["format-parts preventExtensions", c1064], ["format-parts symbol", c1065], ["format-parts index", c1066], ["format-parts index-far", c1067], ["format-parts index-getter", c1068], ["format-parts length", c1069], ["format-parts setPrototypeOf-null", c1070], ["format-parts setPrototypeOf-object", c1071], ["format-parts proto", c1072], ["format-parts assign", c1073], ["format-parts stamp", c1074], ["locales getter", c1075], ["locales reflect-getter", c1076], ["locales setter", c1077], ["locales getter-enumerable", c1078], ["locales data", c1079], ["locales defineProperties", c1080], ["locales defineGetter", c1081], ["locales store", c1082], ["locales store-computed", c1083], ["locales reflect-set", c1084], ["locales delete", c1085], ["locales delete-index", c1086], ["locales freeze", c1087], ["locales seal", c1088], ["locales preventExtensions", c1089], ["locales symbol", c1090], ["locales index", c1091], ["locales index-far", c1092], ["locales index-getter", c1093], ["locales length", c1094], ["locales setPrototypeOf-null", c1095], ["locales setPrototypeOf-object", c1096], ["locales proto", c1097], ["locales assign", c1098], ["locales stamp", c1099], ["search-params-entry getter", c1100], ["search-params-entry reflect-getter", c1101], ["search-params-entry setter", c1102], ["search-params-entry getter-enumerable", c1103], ["search-params-entry data", c1104], ["search-params-entry defineProperties", c1105], ["search-params-entry defineGetter", c1106], ["search-params-entry store", c1107], ["search-params-entry store-computed", c1108], ["search-params-entry reflect-set", c1109], ["search-params-entry delete", c1110], ["search-params-entry delete-index", c1111], ["search-params-entry freeze", c1112], ["search-params-entry seal", c1113], ["search-params-entry preventExtensions", c1114], ["search-params-entry symbol", c1115], ["search-params-entry index", c1116], ["search-params-entry index-far", c1117], ["search-params-entry index-getter", c1118], ["search-params-entry length", c1119], ["search-params-entry setPrototypeOf-null", c1120], ["search-params-entry setPrototypeOf-object", c1121], ["search-params-entry proto", c1122], ["search-params-entry assign", c1123], ["search-params-entry stamp", c1124], ["search-params-all getter", c1125], ["search-params-all reflect-getter", c1126], ["search-params-all setter", c1127], ["search-params-all getter-enumerable", c1128], ["search-params-all data", c1129], ["search-params-all defineProperties", c1130], ["search-params-all defineGetter", c1131], ["search-params-all store", c1132], ["search-params-all store-computed", c1133], ["search-params-all reflect-set", c1134], ["search-params-all delete", c1135], ["search-params-all delete-index", c1136], ["search-params-all freeze", c1137], ["search-params-all seal", c1138], ["search-params-all preventExtensions", c1139], ["search-params-all symbol", c1140], ["search-params-all index", c1141], ["search-params-all index-far", c1142], ["search-params-all index-getter", c1143], ["search-params-all length", c1144], ["search-params-all setPrototypeOf-null", c1145], ["search-params-all setPrototypeOf-object", c1146], ["search-params-all proto", c1147], ["search-params-all assign", c1148], ["search-params-all stamp", c1149], ["headers-entry getter", c1150], ["headers-entry reflect-getter", c1151], ["headers-entry setter", c1152], ["headers-entry getter-enumerable", c1153], ["headers-entry data", c1154], ["headers-entry defineProperties", c1155], ["headers-entry defineGetter", c1156], ["headers-entry store", c1157], ["headers-entry store-computed", c1158], ["headers-entry reflect-set", c1159], ["headers-entry delete", c1160], ["headers-entry delete-index", c1161], ["headers-entry freeze", c1162], ["headers-entry seal", c1163], ["headers-entry preventExtensions", c1164], ["headers-entry symbol", c1165], ["headers-entry index", c1166], ["headers-entry index-far", c1167], ["headers-entry index-getter", c1168], ["headers-entry length", c1169], ["headers-entry setPrototypeOf-null", c1170], ["headers-entry setPrototypeOf-object", c1171], ["headers-entry proto", c1172], ["headers-entry assign", c1173], ["headers-entry stamp", c1174], ["map getter", c1175], ["map reflect-getter", c1176], ["map setter", c1177], ["map getter-enumerable", c1178], ["map data", c1179], ["map defineProperties", c1180], ["map defineGetter", c1181], ["map store", c1182], ["map store-computed", c1183], ["map reflect-set", c1184], ["map delete", c1185], ["map delete-index", c1186], ["map freeze", c1187], ["map seal", c1188], ["map preventExtensions", c1189], ["map symbol", c1190], ["map index", c1191], ["map index-far", c1192], ["map index-getter", c1193], ["map length", c1194], ["map setPrototypeOf-null", c1195], ["map setPrototypeOf-object", c1196], ["map proto", c1197], ["map assign", c1198], ["map stamp", c1199], ["filter getter", c1200], ["filter reflect-getter", c1201], ["filter setter", c1202], ["filter getter-enumerable", c1203], ["filter data", c1204], ["filter defineProperties", c1205], ["filter defineGetter", c1206], ["filter store", c1207], ["filter store-computed", c1208], ["filter reflect-set", c1209], ["filter delete", c1210], ["filter delete-index", c1211], ["filter freeze", c1212], ["filter seal", c1213], ["filter preventExtensions", c1214], ["filter symbol", c1215], ["filter index", c1216], ["filter index-far", c1217], ["filter index-getter", c1218], ["filter length", c1219], ["filter setPrototypeOf-null", c1220], ["filter setPrototypeOf-object", c1221], ["filter proto", c1222], ["filter assign", c1223], ["filter stamp", c1224], ["concat getter", c1225], ["concat reflect-getter", c1226], ["concat setter", c1227], ["concat getter-enumerable", c1228], ["concat data", c1229], ["concat defineProperties", c1230], ["concat defineGetter", c1231], ["concat store", c1232], ["concat store-computed", c1233], ["concat reflect-set", c1234], ["concat delete", c1235], ["concat delete-index", c1236], ["concat freeze", c1237], ["concat seal", c1238], ["concat preventExtensions", c1239], ["concat symbol", c1240], ["concat index", c1241], ["concat index-far", c1242], ["concat index-getter", c1243], ["concat length", c1244], ["concat setPrototypeOf-null", c1245], ["concat setPrototypeOf-object", c1246], ["concat proto", c1247], ["concat assign", c1248], ["concat stamp", c1249], ["slice getter", c1250], ["slice reflect-getter", c1251], ["slice setter", c1252], ["slice getter-enumerable", c1253], ["slice data", c1254], ["slice defineProperties", c1255], ["slice defineGetter", c1256], ["slice store", c1257], ["slice store-computed", c1258], ["slice reflect-set", c1259], ["slice delete", c1260], ["slice delete-index", c1261], ["slice freeze", c1262], ["slice seal", c1263], ["slice preventExtensions", c1264], ["slice symbol", c1265], ["slice index", c1266], ["slice index-far", c1267], ["slice index-getter", c1268], ["slice length", c1269], ["slice setPrototypeOf-null", c1270], ["slice setPrototypeOf-object", c1271], ["slice proto", c1272], ["slice assign", c1273], ["slice stamp", c1274], ["flat getter", c1275], ["flat reflect-getter", c1276], ["flat setter", c1277], ["flat getter-enumerable", c1278], ["flat data", c1279], ["flat defineProperties", c1280], ["flat defineGetter", c1281], ["flat store", c1282], ["flat store-computed", c1283], ["flat reflect-set", c1284], ["flat delete", c1285], ["flat delete-index", c1286], ["flat freeze", c1287], ["flat seal", c1288], ["flat preventExtensions", c1289], ["flat symbol", c1290], ["flat index", c1291], ["flat index-far", c1292], ["flat index-getter", c1293], ["flat length", c1294], ["flat setPrototypeOf-null", c1295], ["flat setPrototypeOf-object", c1296], ["flat proto", c1297], ["flat assign", c1298], ["flat stamp", c1299], ["toSorted getter", c1300], ["toSorted reflect-getter", c1301], ["toSorted setter", c1302], ["toSorted getter-enumerable", c1303], ["toSorted data", c1304], ["toSorted defineProperties", c1305], ["toSorted defineGetter", c1306], ["toSorted store", c1307], ["toSorted store-computed", c1308], ["toSorted reflect-set", c1309], ["toSorted delete", c1310], ["toSorted delete-index", c1311], ["toSorted freeze", c1312], ["toSorted seal", c1313], ["toSorted preventExtensions", c1314], ["toSorted symbol", c1315], ["toSorted index", c1316], ["toSorted index-far", c1317], ["toSorted index-getter", c1318], ["toSorted length", c1319], ["toSorted setPrototypeOf-null", c1320], ["toSorted setPrototypeOf-object", c1321], ["toSorted proto", c1322], ["toSorted assign", c1323], ["toSorted stamp", c1324], ["with getter", c1325], ["with reflect-getter", c1326], ["with setter", c1327], ["with getter-enumerable", c1328], ["with data", c1329], ["with defineProperties", c1330], ["with defineGetter", c1331], ["with store", c1332], ["with store-computed", c1333], ["with reflect-set", c1334], ["with delete", c1335], ["with delete-index", c1336], ["with freeze", c1337], ["with seal", c1338], ["with preventExtensions", c1339], ["with symbol", c1340], ["with index", c1341], ["with index-far", c1342], ["with index-getter", c1343], ["with length", c1344], ["with setPrototypeOf-null", c1345], ["with setPrototypeOf-object", c1346], ["with proto", c1347], ["with assign", c1348], ["with stamp", c1349], ["splice getter", c1350], ["splice reflect-getter", c1351], ["splice setter", c1352], ["splice getter-enumerable", c1353], ["splice data", c1354], ["splice defineProperties", c1355], ["splice defineGetter", c1356], ["splice store", c1357], ["splice store-computed", c1358], ["splice reflect-set", c1359], ["splice delete", c1360], ["splice delete-index", c1361], ["splice freeze", c1362], ["splice seal", c1363], ["splice preventExtensions", c1364], ["splice symbol", c1365], ["splice index", c1366], ["splice index-far", c1367], ["splice index-getter", c1368], ["splice length", c1369], ["splice setPrototypeOf-null", c1370], ["splice setPrototypeOf-object", c1371], ["splice proto", c1372], ["splice assign", c1373], ["splice stamp", c1374], ["new-Object getter", c1375], ["new-Object reflect-getter", c1376], ["new-Object setter", c1377], ["new-Object getter-enumerable", c1378], ["new-Object data", c1379], ["new-Object defineProperties", c1380], ["new-Object defineGetter", c1381], ["new-Object store", c1382], ["new-Object store-computed", c1383], ["new-Object reflect-set", c1384], ["new-Object delete", c1385], ["new-Object delete-index", c1386], ["new-Object freeze", c1387], ["new-Object seal", c1388], ["new-Object preventExtensions", c1389], ["new-Object symbol", c1390], ["new-Object index", c1391], ["new-Object index-far", c1392], ["new-Object index-getter", c1393], ["new-Object length", c1394], ["new-Object setPrototypeOf-null", c1395], ["new-Object setPrototypeOf-object", c1396], ["new-Object proto", c1397], ["new-Object assign", c1398], ["new-Object stamp", c1399], ["Object-call getter", c1400], ["Object-call reflect-getter", c1401], ["Object-call setter", c1402], ["Object-call getter-enumerable", c1403], ["Object-call data", c1404], ["Object-call defineProperties", c1405], ["Object-call defineGetter", c1406], ["Object-call store", c1407], ["Object-call store-computed", c1408], ["Object-call reflect-set", c1409], ["Object-call delete", c1410], ["Object-call delete-index", c1411], ["Object-call freeze", c1412], ["Object-call seal", c1413], ["Object-call preventExtensions", c1414], ["Object-call symbol", c1415], ["Object-call index", c1416], ["Object-call index-far", c1417], ["Object-call index-getter", c1418], ["Object-call length", c1419], ["Object-call setPrototypeOf-null", c1420], ["Object-call setPrototypeOf-object", c1421], ["Object-call proto", c1422], ["Object-call assign", c1423], ["Object-call stamp", c1424], ["Object-of-number getter", c1425], ["Object-of-number reflect-getter", c1426], ["Object-of-number setter", c1427], ["Object-of-number getter-enumerable", c1428], ["Object-of-number data", c1429], ["Object-of-number defineProperties", c1430], ["Object-of-number defineGetter", c1431], ["Object-of-number store", c1432], ["Object-of-number store-computed", c1433], ["Object-of-number reflect-set", c1434], ["Object-of-number delete", c1435], ["Object-of-number delete-index", c1436], ["Object-of-number freeze", c1437], ["Object-of-number seal", c1438], ["Object-of-number preventExtensions", c1439], ["Object-of-number symbol", c1440], ["Object-of-number index", c1441], ["Object-of-number index-far", c1442], ["Object-of-number index-getter", c1443], ["Object-of-number length", c1444], ["Object-of-number setPrototypeOf-null", c1445], ["Object-of-number setPrototypeOf-object", c1446], ["Object-of-number proto", c1447], ["Object-of-number assign", c1448], ["Object-of-number stamp", c1449], ["withResolvers getter", c1450], ["withResolvers reflect-getter", c1451], ["withResolvers setter", c1452], ["withResolvers getter-enumerable", c1453], ["withResolvers data", c1454], ["withResolvers defineProperties", c1455], ["withResolvers defineGetter", c1456], ["withResolvers store", c1457], ["withResolvers store-computed", c1458], ["withResolvers reflect-set", c1459], ["withResolvers delete", c1460], ["withResolvers delete-index", c1461], ["withResolvers freeze", c1462], ["withResolvers seal", c1463], ["withResolvers preventExtensions", c1464], ["withResolvers symbol", c1465], ["withResolvers index", c1466], ["withResolvers index-far", c1467], ["withResolvers index-getter", c1468], ["withResolvers length", c1469], ["withResolvers setPrototypeOf-null", c1470], ["withResolvers setPrototypeOf-object", c1471], ["withResolvers proto", c1472], ["withResolvers assign", c1473], ["withResolvers stamp", c1474], ["spread getter", c1475], ["spread reflect-getter", c1476], ["spread setter", c1477], ["spread getter-enumerable", c1478], ["spread data", c1479], ["spread defineProperties", c1480], ["spread defineGetter", c1481], ["spread store", c1482], ["spread store-computed", c1483], ["spread reflect-set", c1484], ["spread delete", c1485], ["spread delete-index", c1486], ["spread freeze", c1487], ["spread seal", c1488], ["spread preventExtensions", c1489], ["spread symbol", c1490], ["spread index", c1491], ["spread index-far", c1492], ["spread index-getter", c1493], ["spread length", c1494], ["spread setPrototypeOf-null", c1495], ["spread setPrototypeOf-object", c1496], ["spread proto", c1497], ["spread assign", c1498], ["spread stamp", c1499], ["array-spread getter", c1500], ["array-spread reflect-getter", c1501], ["array-spread setter", c1502], ["array-spread getter-enumerable", c1503], ["array-spread data", c1504], ["array-spread defineProperties", c1505], ["array-spread defineGetter", c1506], ["array-spread store", c1507], ["array-spread store-computed", c1508], ["array-spread reflect-set", c1509], ["array-spread delete", c1510], ["array-spread delete-index", c1511], ["array-spread freeze", c1512], ["array-spread seal", c1513], ["array-spread preventExtensions", c1514], ["array-spread symbol", c1515], ["array-spread index", c1516], ["array-spread index-far", c1517], ["array-spread index-getter", c1518], ["array-spread length", c1519], ["array-spread setPrototypeOf-null", c1520], ["array-spread setPrototypeOf-object", c1521], ["array-spread proto", c1522], ["array-spread assign", c1523], ["array-spread stamp", c1524], ["rest getter", c1525], ["rest reflect-getter", c1526], ["rest setter", c1527], ["rest getter-enumerable", c1528], ["rest data", c1529], ["rest defineProperties", c1530], ["rest defineGetter", c1531], ["rest store", c1532], ["rest store-computed", c1533], ["rest reflect-set", c1534], ["rest delete", c1535], ["rest delete-index", c1536], ["rest freeze", c1537], ["rest seal", c1538], ["rest preventExtensions", c1539], ["rest symbol", c1540], ["rest index", c1541], ["rest index-far", c1542], ["rest index-getter", c1543], ["rest length", c1544], ["rest setPrototypeOf-null", c1545], ["rest setPrototypeOf-object", c1546], ["rest proto", c1547], ["rest assign", c1548], ["rest stamp", c1549], ["template getter", c1550], ["template reflect-getter", c1551], ["template setter", c1552], ["template getter-enumerable", c1553], ["template data", c1554], ["template defineProperties", c1555], ["template defineGetter", c1556], ["template store", c1557], ["template store-computed", c1558], ["template reflect-set", c1559], ["template delete", c1560], ["template delete-index", c1561], ["template freeze", c1562], ["template seal", c1563], ["template preventExtensions", c1564], ["template symbol", c1565], ["template index", c1566], ["template index-far", c1567], ["template index-getter", c1568], ["template length", c1569], ["template setPrototypeOf-null", c1570], ["template setPrototypeOf-object", c1571], ["template proto", c1572], ["template assign", c1573], ["template stamp", c1574], ["template-raw getter", c1575], ["template-raw reflect-getter", c1576], ["template-raw setter", c1577], ["template-raw getter-enumerable", c1578], ["template-raw data", c1579], ["template-raw defineProperties", c1580], ["template-raw defineGetter", c1581], ["template-raw store", c1582], ["template-raw store-computed", c1583], ["template-raw reflect-set", c1584], ["template-raw delete", c1585], ["template-raw delete-index", c1586], ["template-raw freeze", c1587], ["template-raw seal", c1588], ["template-raw preventExtensions", c1589], ["template-raw symbol", c1590], ["template-raw index", c1591], ["template-raw index-far", c1592], ["template-raw index-getter", c1593], ["template-raw length", c1594], ["template-raw setPrototypeOf-null", c1595], ["template-raw setPrototypeOf-object", c1596], ["template-raw proto", c1597], ["template-raw assign", c1598], ["template-raw stamp", c1599], ["new-Map getter", c1600], ["new-Map reflect-getter", c1601], ["new-Map setter", c1602], ["new-Map getter-enumerable", c1603], ["new-Map data", c1604], ["new-Map defineProperties", c1605], ["new-Map defineGetter", c1606], ["new-Map store", c1607], ["new-Map store-computed", c1608], ["new-Map reflect-set", c1609], ["new-Map delete", c1610], ["new-Map delete-index", c1611], ["new-Map freeze", c1612], ["new-Map seal", c1613], ["new-Map preventExtensions", c1614], ["new-Map symbol", c1615], ["new-Map index", c1616], ["new-Map index-far", c1617], ["new-Map index-getter", c1618], ["new-Map length", c1619], ["new-Map setPrototypeOf-null", c1620], ["new-Map setPrototypeOf-object", c1621], ["new-Map proto", c1622], ["new-Map assign", c1623], ["new-Map stamp", c1624], ["new-Set getter", c1625], ["new-Set reflect-getter", c1626], ["new-Set setter", c1627], ["new-Set getter-enumerable", c1628], ["new-Set data", c1629], ["new-Set defineProperties", c1630], ["new-Set defineGetter", c1631], ["new-Set store", c1632], ["new-Set store-computed", c1633], ["new-Set reflect-set", c1634], ["new-Set delete", c1635], ["new-Set delete-index", c1636], ["new-Set freeze", c1637], ["new-Set seal", c1638], ["new-Set preventExtensions", c1639], ["new-Set symbol", c1640], ["new-Set index", c1641], ["new-Set index-far", c1642], ["new-Set index-getter", c1643], ["new-Set length", c1644], ["new-Set setPrototypeOf-null", c1645], ["new-Set setPrototypeOf-object", c1646], ["new-Set proto", c1647], ["new-Set assign", c1648], ["new-Set stamp", c1649], ["new-Error getter", c1650], ["new-Error reflect-getter", c1651], ["new-Error setter", c1652], ["new-Error getter-enumerable", c1653], ["new-Error data", c1654], ["new-Error defineProperties", c1655], ["new-Error defineGetter", c1656], ["new-Error store", c1657], ["new-Error store-computed", c1658], ["new-Error reflect-set", c1659], ["new-Error delete", c1660], ["new-Error delete-index", c1661], ["new-Error freeze", c1662], ["new-Error seal", c1663], ["new-Error preventExtensions", c1664], ["new-Error symbol", c1665], ["new-Error index", c1666], ["new-Error index-far", c1667], ["new-Error index-getter", c1668], ["new-Error length", c1669], ["new-Error setPrototypeOf-null", c1670], ["new-Error setPrototypeOf-object", c1671], ["new-Error proto", c1672], ["new-Error assign", c1673], ["new-Error stamp", c1674], ["new-Date getter", c1675], ["new-Date reflect-getter", c1676], ["new-Date setter", c1677], ["new-Date getter-enumerable", c1678], ["new-Date data", c1679], ["new-Date defineProperties", c1680], ["new-Date defineGetter", c1681], ["new-Date store", c1682], ["new-Date store-computed", c1683], ["new-Date reflect-set", c1684], ["new-Date delete", c1685], ["new-Date delete-index", c1686], ["new-Date freeze", c1687], ["new-Date seal", c1688], ["new-Date preventExtensions", c1689], ["new-Date symbol", c1690], ["new-Date index", c1691], ["new-Date index-far", c1692], ["new-Date index-getter", c1693], ["new-Date length", c1694], ["new-Date setPrototypeOf-null", c1695], ["new-Date setPrototypeOf-object", c1696], ["new-Date proto", c1697], ["new-Date assign", c1698], ["new-Date stamp", c1699], ["new-URL getter", c1700], ["new-URL reflect-getter", c1701], ["new-URL setter", c1702], ["new-URL getter-enumerable", c1703], ["new-URL data", c1704], ["new-URL defineProperties", c1705], ["new-URL defineGetter", c1706], ["new-URL store", c1707], ["new-URL store-computed", c1708], ["new-URL reflect-set", c1709], ["new-URL delete", c1710], ["new-URL delete-index", c1711], ["new-URL freeze", c1712], ["new-URL seal", c1713], ["new-URL preventExtensions", c1714], ["new-URL symbol", c1715], ["new-URL index", c1716], ["new-URL index-far", c1717], ["new-URL index-getter", c1718], ["new-URL length", c1719], ["new-URL setPrototypeOf-null", c1720], ["new-URL setPrototypeOf-object", c1721], ["new-URL proto", c1722], ["new-URL assign", c1723], ["new-URL stamp", c1724], ["bound getter", c1725], ["bound reflect-getter", c1726], ["bound setter", c1727], ["bound getter-enumerable", c1728], ["bound data", c1729], ["bound defineProperties", c1730], ["bound defineGetter", c1731], ["bound store", c1732], ["bound store-computed", c1733], ["bound reflect-set", c1734], ["bound delete", c1735], ["bound delete-index", c1736], ["bound freeze", c1737], ["bound seal", c1738], ["bound preventExtensions", c1739], ["bound symbol", c1740], ["bound index", c1741], ["bound index-far", c1742], ["bound index-getter", c1743], ["bound length", c1744], ["bound setPrototypeOf-null", c1745], ["bound setPrototypeOf-object", c1746], ["bound proto", c1747], ["bound assign", c1748], ["bound stamp", c1749], ["typed-array getter", c1750], ["typed-array reflect-getter", c1751], ["typed-array setter", c1752], ["typed-array getter-enumerable", c1753], ["typed-array data", c1754], ["typed-array defineProperties", c1755], ["typed-array defineGetter", c1756], ["typed-array store", c1757], ["typed-array store-computed", c1758], ["typed-array reflect-set", c1759], ["typed-array delete", c1760], ["typed-array delete-index", c1761], ["typed-array freeze", c1762], ["typed-array seal", c1763], ["typed-array preventExtensions", c1764], ["typed-array symbol", c1765], ["typed-array index", c1766], ["typed-array index-far", c1767], ["typed-array index-getter", c1768], ["typed-array length", c1769], ["typed-array setPrototypeOf-null", c1770], ["typed-array setPrototypeOf-object", c1771], ["typed-array proto", c1772], ["typed-array assign", c1773], ["typed-array stamp", c1774], ["array-buffer getter", c1775], ["array-buffer reflect-getter", c1776], ["array-buffer setter", c1777], ["array-buffer getter-enumerable", c1778], ["array-buffer data", c1779], ["array-buffer defineProperties", c1780], ["array-buffer defineGetter", c1781], ["array-buffer store", c1782], ["array-buffer store-computed", c1783], ["array-buffer reflect-set", c1784], ["array-buffer delete", c1785], ["array-buffer delete-index", c1786], ["array-buffer freeze", c1787], ["array-buffer seal", c1788], ["array-buffer preventExtensions", c1789], ["array-buffer symbol", c1790], ["array-buffer index", c1791], ["array-buffer index-far", c1792], ["array-buffer index-getter", c1793], ["array-buffer length", c1794], ["array-buffer setPrototypeOf-null", c1795], ["array-buffer setPrototypeOf-object", c1796], ["array-buffer proto", c1797], ["array-buffer assign", c1798], ["array-buffer stamp", c1799], ["regexp getter", c1800], ["regexp reflect-getter", c1801], ["regexp setter", c1802], ["regexp getter-enumerable", c1803], ["regexp data", c1804], ["regexp defineProperties", c1805], ["regexp defineGetter", c1806], ["regexp store", c1807], ["regexp store-computed", c1808], ["regexp reflect-set", c1809], ["regexp delete", c1810], ["regexp delete-index", c1811], ["regexp freeze", c1812], ["regexp seal", c1813], ["regexp preventExtensions", c1814], ["regexp symbol", c1815], ["regexp index", c1816], ["regexp index-far", c1817], ["regexp index-getter", c1818], ["regexp length", c1819], ["regexp setPrototypeOf-null", c1820], ["regexp setPrototypeOf-object", c1821], ["regexp proto", c1822], ["regexp assign", c1823], ["regexp stamp", c1824], ["memoryUsage getter", c1825], ["memoryUsage reflect-getter", c1826], ["memoryUsage setter", c1827], ["memoryUsage getter-enumerable", c1828], ["memoryUsage data", c1829], ["memoryUsage defineProperties", c1830], ["memoryUsage defineGetter", c1831], ["memoryUsage store", c1832], ["memoryUsage store-computed", c1833], ["memoryUsage reflect-set", c1834], ["memoryUsage delete", c1835], ["memoryUsage delete-index", c1836], ["memoryUsage freeze", c1837], ["memoryUsage seal", c1838], ["memoryUsage preventExtensions", c1839], ["memoryUsage symbol", c1840], ["memoryUsage index", c1841], ["memoryUsage index-far", c1842], ["memoryUsage index-getter", c1843], ["memoryUsage length", c1844], ["memoryUsage setPrototypeOf-null", c1845], ["memoryUsage setPrototypeOf-object", c1846], ["memoryUsage proto", c1847], ["memoryUsage assign", c1848], ["memoryUsage stamp", c1849], ["hrtime getter", c1850], ["hrtime reflect-getter", c1851], ["hrtime setter", c1852], ["hrtime getter-enumerable", c1853], ["hrtime data", c1854], ["hrtime defineProperties", c1855], ["hrtime defineGetter", c1856], ["hrtime store", c1857], ["hrtime store-computed", c1858], ["hrtime reflect-set", c1859], ["hrtime delete", c1860], ["hrtime delete-index", c1861], ["hrtime freeze", c1862], ["hrtime seal", c1863], ["hrtime preventExtensions", c1864], ["hrtime symbol", c1865], ["hrtime index", c1866], ["hrtime index-far", c1867], ["hrtime index-getter", c1868], ["hrtime length", c1869], ["hrtime setPrototypeOf-null", c1870], ["hrtime setPrototypeOf-object", c1871], ["hrtime proto", c1872], ["hrtime assign", c1873], ["hrtime stamp", c1874], ["proxy getter", c1875], ["proxy reflect-getter", c1876], ["proxy setter", c1877], ["proxy getter-enumerable", c1878], ["proxy data", c1879], ["proxy defineProperties", c1880], ["proxy defineGetter", c1881], ["proxy store", c1882], ["proxy store-computed", c1883], ["proxy reflect-set", c1884], ["proxy delete", c1885], ["proxy delete-index", c1886], ["proxy freeze", c1887], ["proxy seal", c1888], ["proxy preventExtensions", c1889], ["proxy symbol", c1890], ["proxy index", c1891], ["proxy index-far", c1892], ["proxy index-getter", c1893], ["proxy length", c1894], ["proxy setPrototypeOf-null", c1895], ["proxy setPrototypeOf-object", c1896], ["proxy proto", c1897], ["proxy assign", c1898], ["proxy stamp", c1899], ["weak-ref getter", c1900], ["weak-ref reflect-getter", c1901], ["weak-ref setter", c1902], ["weak-ref getter-enumerable", c1903], ["weak-ref data", c1904], ["weak-ref defineProperties", c1905], ["weak-ref defineGetter", c1906], ["weak-ref store", c1907], ["weak-ref store-computed", c1908], ["weak-ref reflect-set", c1909], ["weak-ref delete", c1910], ["weak-ref delete-index", c1911], ["weak-ref freeze", c1912], ["weak-ref seal", c1913], ["weak-ref preventExtensions", c1914], ["weak-ref symbol", c1915], ["weak-ref index", c1916], ["weak-ref index-far", c1917], ["weak-ref index-getter", c1918], ["weak-ref length", c1919], ["weak-ref setPrototypeOf-null", c1920], ["weak-ref setPrototypeOf-object", c1921], ["weak-ref proto", c1922], ["weak-ref assign", c1923], ["weak-ref stamp", c1924], ["text-encoder getter", c1925], ["text-encoder reflect-getter", c1926], ["text-encoder setter", c1927], ["text-encoder getter-enumerable", c1928], ["text-encoder data", c1929], ["text-encoder defineProperties", c1930], ["text-encoder defineGetter", c1931], ["text-encoder store", c1932], ["text-encoder store-computed", c1933], ["text-encoder reflect-set", c1934], ["text-encoder delete", c1935], ["text-encoder delete-index", c1936], ["text-encoder freeze", c1937], ["text-encoder seal", c1938], ["text-encoder preventExtensions", c1939], ["text-encoder symbol", c1940], ["text-encoder index", c1941], ["text-encoder index-far", c1942], ["text-encoder index-getter", c1943], ["text-encoder length", c1944], ["text-encoder setPrototypeOf-null", c1945], ["text-encoder setPrototypeOf-object", c1946], ["text-encoder proto", c1947], ["text-encoder assign", c1948], ["text-encoder stamp", c1949], ["set-union getter", c1950], ["set-union reflect-getter", c1951], ["set-union setter", c1952], ["set-union getter-enumerable", c1953], ["set-union data", c1954], ["set-union defineProperties", c1955], ["set-union defineGetter", c1956], ["set-union store", c1957], ["set-union store-computed", c1958], ["set-union reflect-set", c1959], ["set-union delete", c1960], ["set-union delete-index", c1961], ["set-union freeze", c1962], ["set-union seal", c1963], ["set-union preventExtensions", c1964], ["set-union symbol", c1965], ["set-union index", c1966], ["set-union index-far", c1967], ["set-union index-getter", c1968], ["set-union length", c1969], ["set-union setPrototypeOf-null", c1970], ["set-union setPrototypeOf-object", c1971], ["set-union proto", c1972], ["set-union assign", c1973], ["set-union stamp", c1974], ["iterator-toArray getter", c1975], ["iterator-toArray reflect-getter", c1976], ["iterator-toArray setter", c1977], ["iterator-toArray getter-enumerable", c1978], ["iterator-toArray data", c1979], ["iterator-toArray defineProperties", c1980], ["iterator-toArray defineGetter", c1981], ["iterator-toArray store", c1982], ["iterator-toArray store-computed", c1983], ["iterator-toArray reflect-set", c1984], ["iterator-toArray delete", c1985], ["iterator-toArray delete-index", c1986], ["iterator-toArray freeze", c1987], ["iterator-toArray seal", c1988], ["iterator-toArray preventExtensions", c1989], ["iterator-toArray symbol", c1990], ["iterator-toArray index", c1991], ["iterator-toArray index-far", c1992], ["iterator-toArray index-getter", c1993], ["iterator-toArray length", c1994], ["iterator-toArray setPrototypeOf-null", c1995], ["iterator-toArray setPrototypeOf-object", c1996], ["iterator-toArray proto", c1997], ["iterator-toArray assign", c1998], ["iterator-toArray stamp", c1999]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + e.constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
