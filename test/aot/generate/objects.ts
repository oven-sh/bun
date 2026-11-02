// The programs of objects that are mostly a loop written out: thousands of fields, variables or functions that differ in a number. And those that are another program without its types.
import { family, programsOf, text, untypedTwins } from "../generate";

export const programs = () =>
  programsOf({
    "what-a-built-in-made-is-changed-through-a-helper.js": text(
      `// Every built-in that hands out a fresh object or array x every change of it (an accessor, a store, a delete, a level of integrity, a symbol, an index, another prototype, a private name), made through a helper,
// then read where it was born. Each case has its own birth, helper and reads. With a number as its argument the program runs that case alone.
function show(v) {
  let t = typeof v;
  try { t += "|" + Reflect.ownKeys(v).map(String).join(); } catch (e) { t += "|" + e.name; }
  try { t += "|" + (Object.getPrototypeOf(v) === null ? "null" : typeof Object.getPrototypeOf(v)); } catch (e) { t += "|" + e.name; }
  try { t += "|" + Object.isFrozen(v) + Object.isExtensible(v); } catch (e) { t += "|" + e.name; }
  return t;
}`,
      [
        `0(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	1(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	2(X) { try { Object.defineProperty(X, "added", { set(v) {} })
3(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	4(X) { try { Object.defineProperty(X, "added", { value: 7 })	5(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
6(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	7(X) { try { X.added = 7	8(X) { try { X["add" + "ed"] = 7
9(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n}() { const o = Object.fromEntries([]); const said = hc${3 * n}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1}() { const o = Object.fromEntries([]); const said = hc${3 * n + 1}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 2}() { const o = Object.fromEntries([]); const said = hc${3 * n + 2}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc24 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc24(X) { try { new Sc24(X); } catch (e) { return e.name; } return "changed"; }
function c24() { const o = Object.fromEntries([]); const said = hc24(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc24.has(o) + Sc24.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 25}() { const o = Object.fromEntries([["a", 1]]); const said = hc${3 * n + 25}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 26}() { const o = Object.fromEntries([["a", 1]]); const said = hc${3 * n + 26}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 27}() { const o = Object.fromEntries([["a", 1]]); const said = hc${3 * n + 27}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc49 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc49(X) { try { new Sc49(X); } catch (e) { return e.name; } return "changed"; }
function c49() { const o = Object.fromEntries([["a", 1]]); const said = hc49(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc49.has(o) + Sc49.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 50}() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc${3 * n + 50}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 51}() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc${3 * n + 51}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 52}() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc${3 * n + 52}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc74 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc74(X) { try { new Sc74(X); } catch (e) { return e.name; } return "changed"; }
function c74() { const o = Object.fromEntries(new Map([["k", 1]])); const said = hc74(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc74.has(o) + Sc74.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 75}() { const o = Object.groupBy([], () => "group"); const said = hc${3 * n + 75}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 76}() { const o = Object.groupBy([], () => "group"); const said = hc${3 * n + 76}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 77}() { const o = Object.groupBy([], () => "group"); const said = hc${3 * n + 77}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc99 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc99(X) { try { new Sc99(X); } catch (e) { return e.name; } return "changed"; }
function c99() { const o = Object.groupBy([], () => "group"); const said = hc99(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc99.has(o) + Sc99.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc1${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 100}() { const o = Object.groupBy([1], () => "group"); const said = hc${3 * n + 100}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 101}() { const o = Object.groupBy([1], () => "group"); const said = hc${3 * n + 101}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 102}() { const o = Object.groupBy([1], () => "group"); const said = hc${3 * n + 102}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc124 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc124(X) { try { new Sc124(X); } catch (e) { return e.name; } return "changed"; }
function c124() { const o = Object.groupBy([1], () => "group"); const said = hc124(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc124.has(o) + Sc124.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc1${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 125}() { const o = Map.groupBy([1], () => "group"); const said = hc${3 * n + 125}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 126}() { const o = Map.groupBy([1], () => "group"); const said = hc${3 * n + 126}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 127}() { const o = Map.groupBy([1], () => "group"); const said = hc${3 * n + 127}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc149 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc149(X) { try { new Sc149(X); } catch (e) { return e.name; } return "changed"; }
function c149() { const o = Map.groupBy([1], () => "group"); const said = hc149(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc149.has(o) + Sc149.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc1${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 150}() { const o = Object.create(null); const said = hc${3 * n + 150}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 151}() { const o = Object.create(null); const said = hc${3 * n + 151}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 152}() { const o = Object.create(null); const said = hc${3 * n + 152}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc174 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc174(X) { try { new Sc174(X); } catch (e) { return e.name; } return "changed"; }
function c174() { const o = Object.create(null); const said = hc174(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc174.has(o) + Sc174.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc1${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 175}() { const o = Object.create({ above: 1 }); const said = hc${3 * n + 175}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 176}() { const o = Object.create({ above: 1 }); const said = hc${3 * n + 176}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc1${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 177}() { const o = Object.create({ above: 1 }); const said = hc${3 * n + 177}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc199 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc199(X) { try { new Sc199(X); } catch (e) { return e.name; } return "changed"; }
function c199() { const o = Object.create({ above: 1 }); const said = hc199(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc199.has(o) + Sc199.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc2${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 200}() { const o = Object.create(Object.prototype); const said = hc${3 * n + 200}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc2${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 201}() { const o = Object.create(Object.prototype); const said = hc${3 * n + 201}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc2${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 202}() { const o = Object.create(Object.prototype); const said = hc${3 * n + 202}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc224 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc224(X) { try { new Sc224(X); } catch (e) { return e.name; } return "changed"; }
function c224() { const o = Object.create(Object.prototype); const said = hc224(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc224.has(o) + Sc224.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc2${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 225}() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc${3 * n + 225}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc2${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 226}() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc${3 * n + 226}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc2${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 227}() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc${3 * n + 227}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc249 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc249(X) { try { new Sc249(X); } catch (e) { return e.name; } return "changed"; }
function c249() { const o = Object.create(null, { a: { value: 1, enumerable: true } }); const said = hc249(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc249.has(o) + Sc249.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc2${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 250}() { const o = Object.assign({}, { a: 1 }); const said = hc${3 * n + 250}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc2${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 251}() { const o = Object.assign({}, { a: 1 }); const said = hc${3 * n + 251}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc2${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 252}() { const o = Object.assign({}, { a: 1 }); const said = hc${3 * n + 252}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc274 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc274(X) { try { new Sc274(X); } catch (e) { return e.name; } return "changed"; }
function c274() { const o = Object.assign({}, { a: 1 }); const said = hc274(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc274.has(o) + Sc274.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc2${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 275}() { const o = structuredClone({ a: 1 }); const said = hc${3 * n + 275}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc2${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 276}() { const o = structuredClone({ a: 1 }); const said = hc${3 * n + 276}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc2${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 277}() { const o = structuredClone({ a: 1 }); const said = hc${3 * n + 277}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc299 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc299(X) { try { new Sc299(X); } catch (e) { return e.name; } return "changed"; }
function c299() { const o = structuredClone({ a: 1 }); const said = hc299(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc299.has(o) + Sc299.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc3${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 300}() { const o = structuredClone([1]); const said = hc${3 * n + 300}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc3${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 301}() { const o = structuredClone([1]); const said = hc${3 * n + 301}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc3${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 302}() { const o = structuredClone([1]); const said = hc${3 * n + 302}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc324 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc324(X) { try { new Sc324(X); } catch (e) { return e.name; } return "changed"; }
function c324() { const o = structuredClone([1]); const said = hc324(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc324.has(o) + Sc324.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc3${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 325}() { const o = JSON.parse('{"a":1}'); const said = hc${3 * n + 325}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc3${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 326}() { const o = JSON.parse('{"a":1}'); const said = hc${3 * n + 326}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc3${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 327}() { const o = JSON.parse('{"a":1}'); const said = hc${3 * n + 327}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc349 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc349(X) { try { new Sc349(X); } catch (e) { return e.name; } return "changed"; }
function c349() { const o = JSON.parse('{"a":1}'); const said = hc349(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc349.has(o) + Sc349.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc3${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 350}() { const o = JSON.parse('[1]'); const said = hc${3 * n + 350}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc3${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 351}() { const o = JSON.parse('[1]'); const said = hc${3 * n + 351}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc3${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 352}() { const o = JSON.parse('[1]'); const said = hc${3 * n + 352}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc374 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc374(X) { try { new Sc374(X); } catch (e) { return e.name; } return "changed"; }
function c374() { const o = JSON.parse('[1]'); const said = hc374(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc374.has(o) + Sc374.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc3${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 375}() { const o = Array.from([1]); const said = hc${3 * n + 375}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc3${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 376}() { const o = Array.from([1]); const said = hc${3 * n + 376}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc3${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 377}() { const o = Array.from([1]); const said = hc${3 * n + 377}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc399 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc399(X) { try { new Sc399(X); } catch (e) { return e.name; } return "changed"; }
function c399() { const o = Array.from([1]); const said = hc399(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc399.has(o) + Sc399.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc4${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 400}() { const o = Array.from({ length: 1 }); const said = hc${3 * n + 400}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc4${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 401}() { const o = Array.from({ length: 1 }); const said = hc${3 * n + 401}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc4${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 402}() { const o = Array.from({ length: 1 }); const said = hc${3 * n + 402}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc424 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc424(X) { try { new Sc424(X); } catch (e) { return e.name; } return "changed"; }
function c424() { const o = Array.from({ length: 1 }); const said = hc424(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc424.has(o) + Sc424.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc4${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 425}() { const o = Array.of(1); const said = hc${3 * n + 425}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc4${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 426}() { const o = Array.of(1); const said = hc${3 * n + 426}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc4${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 427}() { const o = Array.of(1); const said = hc${3 * n + 427}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc449 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc449(X) { try { new Sc449(X); } catch (e) { return e.name; } return "changed"; }
function c449() { const o = Array.of(1); const said = hc449(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc449.has(o) + Sc449.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc4${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 450}() { const o = new Array(2); const said = hc${3 * n + 450}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc4${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 451}() { const o = new Array(2); const said = hc${3 * n + 451}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc4${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 452}() { const o = new Array(2); const said = hc${3 * n + 452}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc474 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc474(X) { try { new Sc474(X); } catch (e) { return e.name; } return "changed"; }
function c474() { const o = new Array(2); const said = hc474(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc474.has(o) + Sc474.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc4${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 475}() { const o = Array(1, 2); const said = hc${3 * n + 475}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc4${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 476}() { const o = Array(1, 2); const said = hc${3 * n + 476}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc4${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 477}() { const o = Array(1, 2); const said = hc${3 * n + 477}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc499 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc499(X) { try { new Sc499(X); } catch (e) { return e.name; } return "changed"; }
function c499() { const o = Array(1, 2); const said = hc499(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc499.has(o) + Sc499.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc5${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 500}() { const o = Object.entries({ a: 1 }); const said = hc${3 * n + 500}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc5${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 501}() { const o = Object.entries({ a: 1 }); const said = hc${3 * n + 501}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc5${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 502}() { const o = Object.entries({ a: 1 }); const said = hc${3 * n + 502}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc524 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc524(X) { try { new Sc524(X); } catch (e) { return e.name; } return "changed"; }
function c524() { const o = Object.entries({ a: 1 }); const said = hc524(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc524.has(o) + Sc524.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc5${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 525}() { const o = Object.entries({ a: 1 })[0]; const said = hc${3 * n + 525}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc5${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 526}() { const o = Object.entries({ a: 1 })[0]; const said = hc${3 * n + 526}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc5${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 527}() { const o = Object.entries({ a: 1 })[0]; const said = hc${3 * n + 527}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc549 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc549(X) { try { new Sc549(X); } catch (e) { return e.name; } return "changed"; }
function c549() { const o = Object.entries({ a: 1 })[0]; const said = hc549(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc549.has(o) + Sc549.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc5${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 550}() { const o = Object.values({ a: 1 }); const said = hc${3 * n + 550}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc5${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 551}() { const o = Object.values({ a: 1 }); const said = hc${3 * n + 551}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc5${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 552}() { const o = Object.values({ a: 1 }); const said = hc${3 * n + 552}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc574 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc574(X) { try { new Sc574(X); } catch (e) { return e.name; } return "changed"; }
function c574() { const o = Object.values({ a: 1 }); const said = hc574(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc574.has(o) + Sc574.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc5${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 575}() { const o = Object.keys({ a: 1 }); const said = hc${3 * n + 575}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc5${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 576}() { const o = Object.keys({ a: 1 }); const said = hc${3 * n + 576}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc5${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 577}() { const o = Object.keys({ a: 1 }); const said = hc${3 * n + 577}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc599 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc599(X) { try { new Sc599(X); } catch (e) { return e.name; } return "changed"; }
function c599() { const o = Object.keys({ a: 1 }); const said = hc599(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc599.has(o) + Sc599.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc6${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 600}() { const o = Reflect.ownKeys({ a: 1 }); const said = hc${3 * n + 600}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc6${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 601}() { const o = Reflect.ownKeys({ a: 1 }); const said = hc${3 * n + 601}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc6${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 602}() { const o = Reflect.ownKeys({ a: 1 }); const said = hc${3 * n + 602}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc624 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc624(X) { try { new Sc624(X); } catch (e) { return e.name; } return "changed"; }
function c624() { const o = Reflect.ownKeys({ a: 1 }); const said = hc624(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc624.has(o) + Sc624.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc6${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 625}() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc${3 * n + 625}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc6${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 626}() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc${3 * n + 626}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc6${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 627}() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc${3 * n + 627}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc649 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc649(X) { try { new Sc649(X); } catch (e) { return e.name; } return "changed"; }
function c649() { const o = Object.getOwnPropertyNames({ a: 1 }); const said = hc649(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc649.has(o) + Sc649.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc6${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 650}() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc${3 * n + 650}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc6${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 651}() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc${3 * n + 651}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc6${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 652}() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc${3 * n + 652}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc674 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc674(X) { try { new Sc674(X); } catch (e) { return e.name; } return "changed"; }
function c674() { const o = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc674(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc674.has(o) + Sc674.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc6${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 675}() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc${3 * n + 675}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc6${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 676}() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc${3 * n + 676}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc6${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 677}() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc${3 * n + 677}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc699 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc699(X) { try { new Sc699(X); } catch (e) { return e.name; } return "changed"; }
function c699() { const o = Object.getOwnPropertyDescriptors({ a: 1 }); const said = hc699(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc699.has(o) + Sc699.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc7${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 700}() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc${3 * n + 700}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc7${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 701}() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc${3 * n + 701}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc7${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 702}() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc${3 * n + 702}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc724 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc724(X) { try { new Sc724(X); } catch (e) { return e.name; } return "changed"; }
function c724() { const o = Reflect.getOwnPropertyDescriptor({ a: 1 }, "a"); const said = hc724(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc724.has(o) + Sc724.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc7${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 725}() { const o = [1].values().next(); const said = hc${3 * n + 725}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc7${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 726}() { const o = [1].values().next(); const said = hc${3 * n + 726}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc7${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 727}() { const o = [1].values().next(); const said = hc${3 * n + 727}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc749 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc749(X) { try { new Sc749(X); } catch (e) { return e.name; } return "changed"; }
function c749() { const o = [1].values().next(); const said = hc749(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc749.has(o) + Sc749.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc7${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 750}() { const o = [1].entries().next().value; const said = hc${3 * n + 750}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc7${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 751}() { const o = [1].entries().next().value; const said = hc${3 * n + 751}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc7${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 752}() { const o = [1].entries().next().value; const said = hc${3 * n + 752}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc774 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc774(X) { try { new Sc774(X); } catch (e) { return e.name; } return "changed"; }
function c774() { const o = [1].entries().next().value; const said = hc774(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc774.has(o) + Sc774.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc7${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 775}() { const o = new Map([[1, 2]]).entries().next().value; const said = hc${3 * n + 775}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc7${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 776}() { const o = new Map([[1, 2]]).entries().next().value; const said = hc${3 * n + 776}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc7${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 777}() { const o = new Map([[1, 2]]).entries().next().value; const said = hc${3 * n + 777}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc799 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc799(X) { try { new Sc799(X); } catch (e) { return e.name; } return "changed"; }
function c799() { const o = new Map([[1, 2]]).entries().next().value; const said = hc799(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc799.has(o) + Sc799.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc8${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 800}() { const o = (function* () { yield 1; })().next(); const said = hc${3 * n + 800}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc8${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 801}() { const o = (function* () { yield 1; })().next(); const said = hc${3 * n + 801}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc8${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 802}() { const o = (function* () { yield 1; })().next(); const said = hc${3 * n + 802}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc824 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc824(X) { try { new Sc824(X); } catch (e) { return e.name; } return "changed"; }
function c824() { const o = (function* () { yield 1; })().next(); const said = hc824(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc824.has(o) + Sc824.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc8${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 825}() { const o = "ab".match(/a/); const said = hc${3 * n + 825}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc8${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 826}() { const o = "ab".match(/a/); const said = hc${3 * n + 826}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc8${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 827}() { const o = "ab".match(/a/); const said = hc${3 * n + 827}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc849 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc849(X) { try { new Sc849(X); } catch (e) { return e.name; } return "changed"; }
function c849() { const o = "ab".match(/a/); const said = hc849(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc849.has(o) + Sc849.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc8${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 850}() { const o = "ab".match(/(?<x>a)/).groups; const said = hc${3 * n + 850}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc8${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 851}() { const o = "ab".match(/(?<x>a)/).groups; const said = hc${3 * n + 851}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc8${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 852}() { const o = "ab".match(/(?<x>a)/).groups; const said = hc${3 * n + 852}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc874 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc874(X) { try { new Sc874(X); } catch (e) { return e.name; } return "changed"; }
function c874() { const o = "ab".match(/(?<x>a)/).groups; const said = hc874(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc874.has(o) + Sc874.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc8${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 875}() { const o = "aa".match(/a/g); const said = hc${3 * n + 875}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc8${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 876}() { const o = "aa".match(/a/g); const said = hc${3 * n + 876}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc8${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 877}() { const o = "aa".match(/a/g); const said = hc${3 * n + 877}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc899 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc899(X) { try { new Sc899(X); } catch (e) { return e.name; } return "changed"; }
function c899() { const o = "aa".match(/a/g); const said = hc899(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc899.has(o) + Sc899.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc9${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 900}() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc${3 * n + 900}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc9${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 901}() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc${3 * n + 901}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc9${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 902}() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc${3 * n + 902}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc924 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc924(X) { try { new Sc924(X); } catch (e) { return e.name; } return "changed"; }
function c924() { const o = [..."ab".matchAll(/a/g)][0]; const said = hc924(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc924.has(o) + Sc924.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc9${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 925}() { const o = /a/.exec("a"); const said = hc${3 * n + 925}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc9${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 926}() { const o = /a/.exec("a"); const said = hc${3 * n + 926}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc9${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 927}() { const o = /a/.exec("a"); const said = hc${3 * n + 927}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc949 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc949(X) { try { new Sc949(X); } catch (e) { return e.name; } return "changed"; }
function c949() { const o = /a/.exec("a"); const said = hc949(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc949.has(o) + Sc949.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc9${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 950}() { const o = /a/d.exec("a").indices; const said = hc${3 * n + 950}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc9${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 951}() { const o = /a/d.exec("a").indices; const said = hc${3 * n + 951}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc9${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 952}() { const o = /a/d.exec("a").indices; const said = hc${3 * n + 952}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc974 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc974(X) { try { new Sc974(X); } catch (e) { return e.name; } return "changed"; }
function c974() { const o = /a/d.exec("a").indices; const said = hc974(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc974.has(o) + Sc974.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc9${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 975}() { const o = "a,b".split(","); const said = hc${3 * n + 975}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc9${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 976}() { const o = "a,b".split(","); const said = hc${3 * n + 976}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc9${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 977}() { const o = "a,b".split(","); const said = hc${3 * n + 977}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc999 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc999(X) { try { new Sc999(X); } catch (e) { return e.name; } return "changed"; }
function c999() { const o = "a,b".split(","); const said = hc999(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc999.has(o) + Sc999.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc10${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1000}() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc${3 * n + 1000}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc10${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1001}() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc${3 * n + 1001}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc10${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1002}() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc${3 * n + 1002}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1024 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1024(X) { try { new Sc1024(X); } catch (e) { return e.name; } return "changed"; }
function c1024() { const o = new Intl.NumberFormat('en').resolvedOptions(); const said = hc1024(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1024.has(o) + Sc1024.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc10${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1025}() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc${3 * n + 1025}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc10${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1026}() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc${3 * n + 1026}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc10${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1027}() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc${3 * n + 1027}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1049 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1049(X) { try { new Sc1049(X); } catch (e) { return e.name; } return "changed"; }
function c1049() { const o = new Intl.DateTimeFormat('en', { timeZone: 'UTC' }).resolvedOptions(); const said = hc1049(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1049.has(o) + Sc1049.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc10${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1050}() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc${3 * n + 1050}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc10${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1051}() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc${3 * n + 1051}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc10${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1052}() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc${3 * n + 1052}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1074 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1074(X) { try { new Sc1074(X); } catch (e) { return e.name; } return "changed"; }
function c1074() { const o = new Intl.NumberFormat('en').formatToParts(1); const said = hc1074(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1074.has(o) + Sc1074.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc10${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1075}() { const o = Intl.getCanonicalLocales('en'); const said = hc${3 * n + 1075}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc10${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1076}() { const o = Intl.getCanonicalLocales('en'); const said = hc${3 * n + 1076}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc10${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1077}() { const o = Intl.getCanonicalLocales('en'); const said = hc${3 * n + 1077}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1099 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1099(X) { try { new Sc1099(X); } catch (e) { return e.name; } return "changed"; }
function c1099() { const o = Intl.getCanonicalLocales('en'); const said = hc1099(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1099.has(o) + Sc1099.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc11${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1100}() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc${3 * n + 1100}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc11${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1101}() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc${3 * n + 1101}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc11${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1102}() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc${3 * n + 1102}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1124 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1124(X) { try { new Sc1124(X); } catch (e) { return e.name; } return "changed"; }
function c1124() { const o = [...new URLSearchParams("a=1").entries()][0]; const said = hc1124(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1124.has(o) + Sc1124.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc11${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1125}() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc${3 * n + 1125}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc11${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1126}() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc${3 * n + 1126}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc11${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1127}() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc${3 * n + 1127}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1149 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1149(X) { try { new Sc1149(X); } catch (e) { return e.name; } return "changed"; }
function c1149() { const o = new URLSearchParams("a=1").getAll("a"); const said = hc1149(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1149.has(o) + Sc1149.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc11${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1150}() { const o = [...new Headers({ a: "1" })][0]; const said = hc${3 * n + 1150}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc11${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1151}() { const o = [...new Headers({ a: "1" })][0]; const said = hc${3 * n + 1151}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc11${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1152}() { const o = [...new Headers({ a: "1" })][0]; const said = hc${3 * n + 1152}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1174 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1174(X) { try { new Sc1174(X); } catch (e) { return e.name; } return "changed"; }
function c1174() { const o = [...new Headers({ a: "1" })][0]; const said = hc1174(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1174.has(o) + Sc1174.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc11${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1175}() { const o = [1].map(x => x); const said = hc${3 * n + 1175}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc11${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1176}() { const o = [1].map(x => x); const said = hc${3 * n + 1176}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc11${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1177}() { const o = [1].map(x => x); const said = hc${3 * n + 1177}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1199 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1199(X) { try { new Sc1199(X); } catch (e) { return e.name; } return "changed"; }
function c1199() { const o = [1].map(x => x); const said = hc1199(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1199.has(o) + Sc1199.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc12${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1200}() { const o = [1].filter(x => x); const said = hc${3 * n + 1200}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc12${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1201}() { const o = [1].filter(x => x); const said = hc${3 * n + 1201}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc12${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1202}() { const o = [1].filter(x => x); const said = hc${3 * n + 1202}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1224 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1224(X) { try { new Sc1224(X); } catch (e) { return e.name; } return "changed"; }
function c1224() { const o = [1].filter(x => x); const said = hc1224(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1224.has(o) + Sc1224.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc12${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1225}() { const o = [1].concat(); const said = hc${3 * n + 1225}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc12${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1226}() { const o = [1].concat(); const said = hc${3 * n + 1226}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc12${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1227}() { const o = [1].concat(); const said = hc${3 * n + 1227}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1249 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1249(X) { try { new Sc1249(X); } catch (e) { return e.name; } return "changed"; }
function c1249() { const o = [1].concat(); const said = hc1249(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1249.has(o) + Sc1249.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc12${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1250}() { const o = [1].slice(); const said = hc${3 * n + 1250}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc12${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1251}() { const o = [1].slice(); const said = hc${3 * n + 1251}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc12${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1252}() { const o = [1].slice(); const said = hc${3 * n + 1252}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1274 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1274(X) { try { new Sc1274(X); } catch (e) { return e.name; } return "changed"; }
function c1274() { const o = [1].slice(); const said = hc1274(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1274.has(o) + Sc1274.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc12${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1275}() { const o = [[1]].flat(); const said = hc${3 * n + 1275}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc12${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1276}() { const o = [[1]].flat(); const said = hc${3 * n + 1276}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc12${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1277}() { const o = [[1]].flat(); const said = hc${3 * n + 1277}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1299 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1299(X) { try { new Sc1299(X); } catch (e) { return e.name; } return "changed"; }
function c1299() { const o = [[1]].flat(); const said = hc1299(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1299.has(o) + Sc1299.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc13${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1300}() { const o = [1].toSorted(); const said = hc${3 * n + 1300}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc13${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1301}() { const o = [1].toSorted(); const said = hc${3 * n + 1301}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc13${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1302}() { const o = [1].toSorted(); const said = hc${3 * n + 1302}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1324 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1324(X) { try { new Sc1324(X); } catch (e) { return e.name; } return "changed"; }
function c1324() { const o = [1].toSorted(); const said = hc1324(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1324.has(o) + Sc1324.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc13${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1325}() { const o = [1].with(0, 2); const said = hc${3 * n + 1325}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc13${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1326}() { const o = [1].with(0, 2); const said = hc${3 * n + 1326}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc13${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1327}() { const o = [1].with(0, 2); const said = hc${3 * n + 1327}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1349 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1349(X) { try { new Sc1349(X); } catch (e) { return e.name; } return "changed"; }
function c1349() { const o = [1].with(0, 2); const said = hc1349(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1349.has(o) + Sc1349.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc13${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1350}() { const o = [1, 2].splice(0, 1); const said = hc${3 * n + 1350}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc13${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1351}() { const o = [1, 2].splice(0, 1); const said = hc${3 * n + 1351}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc13${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1352}() { const o = [1, 2].splice(0, 1); const said = hc${3 * n + 1352}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1374 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1374(X) { try { new Sc1374(X); } catch (e) { return e.name; } return "changed"; }
function c1374() { const o = [1, 2].splice(0, 1); const said = hc1374(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1374.has(o) + Sc1374.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc13${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1375}() { const o = new Object(); const said = hc${3 * n + 1375}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc13${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1376}() { const o = new Object(); const said = hc${3 * n + 1376}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc13${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1377}() { const o = new Object(); const said = hc${3 * n + 1377}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1399 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1399(X) { try { new Sc1399(X); } catch (e) { return e.name; } return "changed"; }
function c1399() { const o = new Object(); const said = hc1399(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1399.has(o) + Sc1399.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc14${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1400}() { const o = Object(); const said = hc${3 * n + 1400}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc14${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1401}() { const o = Object(); const said = hc${3 * n + 1401}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc14${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1402}() { const o = Object(); const said = hc${3 * n + 1402}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1424 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1424(X) { try { new Sc1424(X); } catch (e) { return e.name; } return "changed"; }
function c1424() { const o = Object(); const said = hc1424(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1424.has(o) + Sc1424.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc14${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1425}() { const o = Object(1); const said = hc${3 * n + 1425}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc14${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1426}() { const o = Object(1); const said = hc${3 * n + 1426}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc14${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1427}() { const o = Object(1); const said = hc${3 * n + 1427}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1449 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1449(X) { try { new Sc1449(X); } catch (e) { return e.name; } return "changed"; }
function c1449() { const o = Object(1); const said = hc1449(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1449.has(o) + Sc1449.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc14${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1450}() { const o = Promise.withResolvers(); const said = hc${3 * n + 1450}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc14${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1451}() { const o = Promise.withResolvers(); const said = hc${3 * n + 1451}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc14${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1452}() { const o = Promise.withResolvers(); const said = hc${3 * n + 1452}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1474 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1474(X) { try { new Sc1474(X); } catch (e) { return e.name; } return "changed"; }
function c1474() { const o = Promise.withResolvers(); const said = hc1474(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1474.has(o) + Sc1474.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc14${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1475}() { const o = { ...{ a: 1 } }; const said = hc${3 * n + 1475}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc14${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1476}() { const o = { ...{ a: 1 } }; const said = hc${3 * n + 1476}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc14${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1477}() { const o = { ...{ a: 1 } }; const said = hc${3 * n + 1477}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1499 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1499(X) { try { new Sc1499(X); } catch (e) { return e.name; } return "changed"; }
function c1499() { const o = { ...{ a: 1 } }; const said = hc1499(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1499.has(o) + Sc1499.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc15${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1500}() { const o = [...[1]]; const said = hc${3 * n + 1500}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc15${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1501}() { const o = [...[1]]; const said = hc${3 * n + 1501}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc15${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1502}() { const o = [...[1]]; const said = hc${3 * n + 1502}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1524 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1524(X) { try { new Sc1524(X); } catch (e) { return e.name; } return "changed"; }
function c1524() { const o = [...[1]]; const said = hc1524(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1524.has(o) + Sc1524.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc15${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1525}() { const o = ((...rest) => rest)(1); const said = hc${3 * n + 1525}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc15${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1526}() { const o = ((...rest) => rest)(1); const said = hc${3 * n + 1526}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc15${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1527}() { const o = ((...rest) => rest)(1); const said = hc${3 * n + 1527}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1549 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1549(X) { try { new Sc1549(X); } catch (e) { return e.name; } return "changed"; }
function c1549() { const o = ((...rest) => rest)(1); const said = hc1549(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1549.has(o) + Sc1549.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc15${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1550}() { const o = (s => s)\`a\${1}b\`; const said = hc${3 * n + 1550}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc15${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1551}() { const o = (s => s)\`a\${1}b\`; const said = hc${3 * n + 1551}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc15${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1552}() { const o = (s => s)\`a\${1}b\`; const said = hc${3 * n + 1552}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1574 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1574(X) { try { new Sc1574(X); } catch (e) { return e.name; } return "changed"; }
function c1574() { const o = (s => s)\`a\${1}b\`; const said = hc1574(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1574.has(o) + Sc1574.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc15${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1575}() { const o = (s => s)\`a\${1}b\`.raw; const said = hc${3 * n + 1575}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc15${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1576}() { const o = (s => s)\`a\${1}b\`.raw; const said = hc${3 * n + 1576}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc15${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1577}() { const o = (s => s)\`a\${1}b\`.raw; const said = hc${3 * n + 1577}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1599 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1599(X) { try { new Sc1599(X); } catch (e) { return e.name; } return "changed"; }
function c1599() { const o = (s => s)\`a\${1}b\`.raw; const said = hc1599(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1599.has(o) + Sc1599.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc16${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1600}() { const o = new Map(); const said = hc${3 * n + 1600}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc16${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1601}() { const o = new Map(); const said = hc${3 * n + 1601}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc16${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1602}() { const o = new Map(); const said = hc${3 * n + 1602}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1624 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1624(X) { try { new Sc1624(X); } catch (e) { return e.name; } return "changed"; }
function c1624() { const o = new Map(); const said = hc1624(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1624.has(o) + Sc1624.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc16${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1625}() { const o = new Set(); const said = hc${3 * n + 1625}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc16${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1626}() { const o = new Set(); const said = hc${3 * n + 1626}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc16${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1627}() { const o = new Set(); const said = hc${3 * n + 1627}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1649 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1649(X) { try { new Sc1649(X); } catch (e) { return e.name; } return "changed"; }
function c1649() { const o = new Set(); const said = hc1649(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1649.has(o) + Sc1649.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc16${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1650}() { const o = new Error("x"); const said = hc${3 * n + 1650}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc16${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1651}() { const o = new Error("x"); const said = hc${3 * n + 1651}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc16${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1652}() { const o = new Error("x"); const said = hc${3 * n + 1652}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1674 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1674(X) { try { new Sc1674(X); } catch (e) { return e.name; } return "changed"; }
function c1674() { const o = new Error("x"); const said = hc1674(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1674.has(o) + Sc1674.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc16${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1675}() { const o = new Date(0); const said = hc${3 * n + 1675}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc16${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1676}() { const o = new Date(0); const said = hc${3 * n + 1676}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc16${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1677}() { const o = new Date(0); const said = hc${3 * n + 1677}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1699 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1699(X) { try { new Sc1699(X); } catch (e) { return e.name; } return "changed"; }
function c1699() { const o = new Date(0); const said = hc1699(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1699.has(o) + Sc1699.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc17${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1700}() { const o = new URL("http://a/"); const said = hc${3 * n + 1700}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc17${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1701}() { const o = new URL("http://a/"); const said = hc${3 * n + 1701}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc17${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1702}() { const o = new URL("http://a/"); const said = hc${3 * n + 1702}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1724 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1724(X) { try { new Sc1724(X); } catch (e) { return e.name; } return "changed"; }
function c1724() { const o = new URL("http://a/"); const said = hc1724(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1724.has(o) + Sc1724.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc17${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1725}() { const o = (function () {}).bind(null); const said = hc${3 * n + 1725}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc17${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1726}() { const o = (function () {}).bind(null); const said = hc${3 * n + 1726}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc17${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1727}() { const o = (function () {}).bind(null); const said = hc${3 * n + 1727}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1749 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1749(X) { try { new Sc1749(X); } catch (e) { return e.name; } return "changed"; }
function c1749() { const o = (function () {}).bind(null); const said = hc1749(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1749.has(o) + Sc1749.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc17${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1750}() { const o = new Uint8Array(2); const said = hc${3 * n + 1750}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc17${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1751}() { const o = new Uint8Array(2); const said = hc${3 * n + 1751}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc17${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1752}() { const o = new Uint8Array(2); const said = hc${3 * n + 1752}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1774 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1774(X) { try { new Sc1774(X); } catch (e) { return e.name; } return "changed"; }
function c1774() { const o = new Uint8Array(2); const said = hc1774(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1774.has(o) + Sc1774.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc17${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1775}() { const o = new ArrayBuffer(2); const said = hc${3 * n + 1775}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc17${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1776}() { const o = new ArrayBuffer(2); const said = hc${3 * n + 1776}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc17${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1777}() { const o = new ArrayBuffer(2); const said = hc${3 * n + 1777}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1799 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1799(X) { try { new Sc1799(X); } catch (e) { return e.name; } return "changed"; }
function c1799() { const o = new ArrayBuffer(2); const said = hc1799(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1799.has(o) + Sc1799.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc18${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1800}() { const o = new RegExp("a"); const said = hc${3 * n + 1800}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc18${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1801}() { const o = new RegExp("a"); const said = hc${3 * n + 1801}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc18${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1802}() { const o = new RegExp("a"); const said = hc${3 * n + 1802}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1824 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1824(X) { try { new Sc1824(X); } catch (e) { return e.name; } return "changed"; }
function c1824() { const o = new RegExp("a"); const said = hc1824(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1824.has(o) + Sc1824.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc18${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1825}() { const o = process.memoryUsage(); const said = hc${3 * n + 1825}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc18${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1826}() { const o = process.memoryUsage(); const said = hc${3 * n + 1826}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc18${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1827}() { const o = process.memoryUsage(); const said = hc${3 * n + 1827}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1849 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1849(X) { try { new Sc1849(X); } catch (e) { return e.name; } return "changed"; }
function c1849() { const o = process.memoryUsage(); const said = hc1849(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1849.has(o) + Sc1849.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc18${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1850}() { const o = process.hrtime(); const said = hc${3 * n + 1850}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc18${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1851}() { const o = process.hrtime(); const said = hc${3 * n + 1851}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc18${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1852}() { const o = process.hrtime(); const said = hc${3 * n + 1852}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1874 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1874(X) { try { new Sc1874(X); } catch (e) { return e.name; } return "changed"; }
function c1874() { const o = process.hrtime(); const said = hc1874(o); return said + "|" + o.added + "|" + typeof o.added + "|" + typeof o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1874.has(o) + Sc1874.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc18${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1875}() { const o = new Proxy({}, {}); const said = hc${3 * n + 1875}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc18${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1876}() { const o = new Proxy({}, {}); const said = hc${3 * n + 1876}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc18${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1877}() { const o = new Proxy({}, {}); const said = hc${3 * n + 1877}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1899 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1899(X) { try { new Sc1899(X); } catch (e) { return e.name; } return "changed"; }
function c1899() { const o = new Proxy({}, {}); const said = hc1899(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1899.has(o) + Sc1899.read(o); }`,
      [
        `00(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	01(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	02(X) { try { Object.defineProperty(X, "added", { set(v) {} })
03(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	04(X) { try { Object.defineProperty(X, "added", { value: 7 })	05(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
06(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	07(X) { try { X.added = 7	08(X) { try { X["add" + "ed"] = 7
09(X) { try { Reflect.set(X, "added", 7)	10(X) { try { delete X.a	11(X) { try { delete X[0]
12(X) { try { Object.freeze(X)	13(X) { try { Object.seal(X)	14(X) { try { Object.preventExtensions(X)
15(X) { try { X[Symbol.for("added")] = 7	16(X) { try { X[0] = 7	17(X) { try { X[1000] = 7
18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	19(X) { try { X.length = 0	20(X) { try { Object.setPrototypeOf(X, null)
21(X) { try { Object.setPrototypeOf(X, { added: 7 })	22(X) { try { X.__proto__ = { added: 7 }	23(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc19${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1900}() { const o = new WeakRef({}); const said = hc${3 * n + 1900}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc19${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1901}() { const o = new WeakRef({}); const said = hc${3 * n + 1901}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc19${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1902}() { const o = new WeakRef({}); const said = hc${3 * n + 1902}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1924 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1924(X) { try { new Sc1924(X); } catch (e) { return e.name; } return "changed"; }
function c1924() { const o = new WeakRef({}); const said = hc1924(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1924.has(o) + Sc1924.read(o); }`,
      [
        `25(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	26(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	27(X) { try { Object.defineProperty(X, "added", { set(v) {} })
28(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	29(X) { try { Object.defineProperty(X, "added", { value: 7 })	30(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
31(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	32(X) { try { X.added = 7	33(X) { try { X["add" + "ed"] = 7
34(X) { try { Reflect.set(X, "added", 7)	35(X) { try { delete X.a	36(X) { try { delete X[0]
37(X) { try { Object.freeze(X)	38(X) { try { Object.seal(X)	39(X) { try { Object.preventExtensions(X)
40(X) { try { X[Symbol.for("added")] = 7	41(X) { try { X[0] = 7	42(X) { try { X[1000] = 7
43(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	44(X) { try { X.length = 0	45(X) { try { Object.setPrototypeOf(X, null)
46(X) { try { Object.setPrototypeOf(X, { added: 7 })	47(X) { try { X.__proto__ = { added: 7 }	48(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc19${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1925}() { const o = new TextEncoder().encode("a"); const said = hc${3 * n + 1925}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc19${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1926}() { const o = new TextEncoder().encode("a"); const said = hc${3 * n + 1926}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc19${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1927}() { const o = new TextEncoder().encode("a"); const said = hc${3 * n + 1927}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1949 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1949(X) { try { new Sc1949(X); } catch (e) { return e.name; } return "changed"; }
function c1949() { const o = new TextEncoder().encode("a"); const said = hc1949(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1949.has(o) + Sc1949.read(o); }`,
      [
        `50(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	51(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	52(X) { try { Object.defineProperty(X, "added", { set(v) {} })
53(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	54(X) { try { Object.defineProperty(X, "added", { value: 7 })	55(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
56(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	57(X) { try { X.added = 7	58(X) { try { X["add" + "ed"] = 7
59(X) { try { Reflect.set(X, "added", 7)	60(X) { try { delete X.a	61(X) { try { delete X[0]
62(X) { try { Object.freeze(X)	63(X) { try { Object.seal(X)	64(X) { try { Object.preventExtensions(X)
65(X) { try { X[Symbol.for("added")] = 7	66(X) { try { X[0] = 7	67(X) { try { X[1000] = 7
68(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	69(X) { try { X.length = 0	70(X) { try { Object.setPrototypeOf(X, null)
71(X) { try { Object.setPrototypeOf(X, { added: 7 })	72(X) { try { X.__proto__ = { added: 7 }	73(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc19${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1950}() { const o = new Set([1]).union(new Set([2])); const said = hc${3 * n + 1950}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc19${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1951}() { const o = new Set([1]).union(new Set([2])); const said = hc${3 * n + 1951}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc19${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1952}() { const o = new Set([1]).union(new Set([2])); const said = hc${3 * n + 1952}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1974 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
function hc1974(X) { try { new Sc1974(X); } catch (e) { return e.name; } return "changed"; }
function c1974() { const o = new Set([1]).union(new Set([2])); const said = hc1974(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o) + "|" + Sc1974.has(o) + Sc1974.read(o); }`,
      [
        `75(X) { try { Object.defineProperty(X, "added", { get() { return 7; } })	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; } })	77(X) { try { Object.defineProperty(X, "added", { set(v) {} })
78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true })	79(X) { try { Object.defineProperty(X, "added", { value: 7 })	80(X) { try { Object.defineProperties(X, { added: { get() { return 7; } } })
81(X) { try { X.__defineGetter__ ? X.__defineGetter__("added", () => 7) : Object.prototype.__defineGetter__.call(X, "added", () => 7)	82(X) { try { X.added = 7	83(X) { try { X["add" + "ed"] = 7
84(X) { try { Reflect.set(X, "added", 7)	85(X) { try { delete X.a	86(X) { try { delete X[0]
87(X) { try { Object.freeze(X)	88(X) { try { Object.seal(X)	89(X) { try { Object.preventExtensions(X)
90(X) { try { X[Symbol.for("added")] = 7	91(X) { try { X[0] = 7	92(X) { try { X[1000] = 7
93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true })	94(X) { try { X.length = 0	95(X) { try { Object.setPrototypeOf(X, null)
96(X) { try { Object.setPrototypeOf(X, { added: 7 })	97(X) { try { X.__proto__ = { added: 7 }	98(X) { try { Object.assign(X, { added: 7 })`,
        (n, a, b, c) => `function hc19${a}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1975}() { const o = [1].values().toArray(); const said = hc${3 * n + 1975}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc19${b}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1976}() { const o = [1].values().toArray(); const said = hc${3 * n + 1976}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
function hc19${c}; } catch (e) { return e.name; } return "changed"; }
function c${3 * n + 1977}() { const o = [1].values().toArray(); const said = hc${3 * n + 1977}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }`,
      ],
      `class Sc1999 extends function (given) { return given; } { #secret = 1; static has(given) { return #secret in given; } static read(given) { return given.#secret; } }
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
`,
    ),
    ...family(
      `what-object-from-entries-made-of-nothing-gets-a-getter-by-reflect.js	1(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; }	1() { const o = Object.fromEntries([]); const said = hc1	1
what-object-from-entries-made-of-nothing-gets-a-getter-under-an-index.js	18(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true	18() { const o = Object.fromEntries([]); const said = hc18	18
what-object-from-entries-made-of-nothing-gets-a-getter.js	0(X) { try { Object.defineProperty(X, "added", { get() { return 7; }	0() { const o = Object.fromEntries([]); const said = hc0	0
what-object-from-entries-made-of-nothing-gets-an-enumerable-getter.js	3(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true	3() { const o = Object.fromEntries([]); const said = hc3	3
what-object-group-by-made-of-nothing-gets-a-getter-by-reflect.js	76(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; }	76() { const o = Object.groupBy([], () => "group"); const said = hc76	76
what-object-group-by-made-of-nothing-gets-a-getter-under-an-index.js	93(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true	93() { const o = Object.groupBy([], () => "group"); const said = hc93	93
what-object-group-by-made-of-nothing-gets-a-getter.js	75(X) { try { Object.defineProperty(X, "added", { get() { return 7; }	75() { const o = Object.groupBy([], () => "group"); const said = hc75	75
what-object-group-by-made-of-nothing-gets-an-enumerable-getter.js	78(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true	78() { const o = Object.groupBy([], () => "group"); const said = hc78	78
what-object-group-by-made-of-one-item-gets-a-getter-by-reflect.js	101(X) { try { Reflect.defineProperty(X, "added", { get() { return 7; }	101() { const o = Object.groupBy([1], () => "group"); const said = hc101	101
what-object-group-by-made-of-one-item-gets-a-getter-under-an-index.js	118(X) { try { Object.defineProperty(X, 0, { get() { return 7; }, configurable: true	118() { const o = Object.groupBy([1], () => "group"); const said = hc118	118
what-object-group-by-made-of-one-item-gets-a-getter.js	100(X) { try { Object.defineProperty(X, "added", { get() { return 7; }	100() { const o = Object.groupBy([1], () => "group"); const said = hc100	100
what-object-group-by-made-of-one-item-gets-an-enumerable-getter.js	103(X) { try { Object.defineProperty(X, "added", { get() { return 7; }, enumerable: true, configurable: true	103() { const o = Object.groupBy([1], () => "group"); const said = hc103	103`,
      (
        a,
        b,
        c,
      ) => `// What a built-in answers is made by the built-in. The compiler reads a model of it, which is never run: the object has no layout of the model, whatever is defined on it later.
function show(v) {
  let t = typeof v;
  try { t += "|" + Reflect.ownKeys(v).map(String).join(); } catch (e) { t += "|" + e.name; }
  try { t += "|" + (Object.getPrototypeOf(v) === null ? "null" : typeof Object.getPrototypeOf(v)); } catch (e) { t += "|" + e.name; }
  try { t += "|" + Object.isFrozen(v) + Object.isExtensible(v); } catch (e) { t += "|" + e.name; }
  return t;
}
function hc${a} }); } catch (e) { return e.name; } return "changed"; }
function c${b}(o); return said + "|" + o.added + "|" + typeof o.added + "|" + o[0] + "|" + o.a + "|" + o.length + "|" + ("added" in o) + "|" + show(o); }
let said; try { said = c${c}(); } catch (e) { said = "throws " + e.constructor.name; }
console.log(said);
`,
    ),
    ...family(
      `warm-reads-then-a-name-is-added-above.js	bove them get names	top gets a name", () => { top.added = "top.added"	middle gets the name too", () => { middle.added = "middle.added";	middle gets a name that hides the top's", () => { middle.value = "middle.value";	prototype of a constructor function gets a name", () => { Old.prototype.added = "Old.added";
warm-reads-then-a-name-is-deleted-above.js	bove them lose names	middle loses what hid the top's", () => { delete middle.hidden	top loses it too", () => { delete top.hidden;	top loses a value", () => { delete top.value;	prototype of a constructor function loses its method and its value", () => { delete Old.prototype.method; delete Old.prototype.value;
warm-reads-then-objects-are-frozen.js	re frozen, sealed and closed	top is frozen", () => { Object.freeze(top)	middle is sealed", () => { Object.seal(middle);	receivers take no more properties", () => { for (const [, receiver] of receivers) Object.preventExtensions(receiver);	receivers are frozen", () => { for (const [, receiver] of receivers) Object.freeze(receiver);
warm-reads-then-the-storage-above-grows.js	bove them get so many names that what they had moves to other storage	top gets seven names", () => { for (let i = 0; i < 7; i++) top["t" + i + unknown] = i	top gets forty more, the reads go on in between", () => { for (let i = 7; i < 47; i++) { top["t" + i + unknown] = i; for (const [, receiver] of receivers) if (readers.own(receiver) !== "own" || (readers.middleOnly(receiver) !== undefined && readers.value(receiver) !== "top.value")) throw new Error("wrong behind " + i); }	middle and the prototype of a constructor function get forty", () => { for (let i = 0; i < 40; i++) { middle["m" + i + unknown] = i; Old.prototype["o" + i + unknown] = i; }	prototype objects of the classes get forty", () => { for (let i = 0; i < 40; i++) { Base.prototype["b" + i + unknown] = i; Derived.prototype["d" + i + unknown] = i; }`,
      (a, b, c, d, e) => `"use strict";
// Reads by name of many kinds of receivers at sites that see them all, 200 times over; then objects a${a}; then the same reads again, of the same objects and of new ones.
const unknown = String(process.argv.length > 99 ? process.argv[99] : "");
class Base {
  constructor() {
    this.own = "own";
  }
  method() {
    return "Base.method";
  }
  shared() {
    return "Base.shared";
  }
  get getter() {
    return "Base.getter";
  }
}
class Derived extends Base {
  method() {
    return "Derived.method";
  }
}
class OtherBase {
  shared() {
    return "OtherBase.shared";
  }
  added() {
    return "OtherBase.added";
  }
}
function Old() {
  this.own = "own";
}
Old.prototype.method = function oldMethod() {};
Old.prototype.value = "Old.value";
const top = { value: "top.value", hidden: "top.hidden", method: function topMethod() {} };
const middle = Object.setPrototypeOf({ hidden: "middle.hidden", middleOnly: "middle.only" }, top);
const otherTop = { value: "otherTop.value", added: "otherTop.added" };
const makers = {
  parsed: () => Object.setPrototypeOf(JSON.parse('{"own":"own","n":1}'), middle),
  created: () => Object.assign(Object.create(middle), { own: "own" }),
  belowTop: () => Object.defineProperty(Object.assign(Object.create(top), { own: "own" }), "hidden", { value: "own hidden", writable: true, enumerable: true, configurable: true }),
  plain: () => JSON.parse('{"own":"own"}'),
  instance: () => new Derived(),
  base: () => new Base(),
  instanceWithMore: () => Object.assign(new Derived(), { ["more" + unknown]: 1 }),
  old: () => new Old(),
  literal: () => ({ own: "own", value: "literal.value" }),
  bare: () => Object.assign(Object.create(null), { own: "own" }),
};
const readers = {
  own: o => o.own,
  value: o => o.value,
  hidden: o => o.hidden,
  middleOnly: o => o.middleOnly,
  method: o => o.method,
  shared: o => o.shared,
  getter: o => o.getter,
  added: o => o.added,
  toString: o => o.toString,
  constructor: o => o.constructor,
  zero: o => o[0],
  zeroAsText: o => o["0"],
  proto: o => o.__proto__ === Object.getPrototypeOf(o),
};
const show = value => (typeof value === "function" ? "function " + value.name : String(value));
const makeAll = () => Object.entries(makers).map(([kind, make]) => [kind, make()]);
function readAll(receivers) {
  const lines = [];
  for (const [kind, receiver] of receivers) {
    const words = [];
    for (const name in readers) words.push(name + "=" + show(readers[name](receiver)));
    lines.push(kind + ": " + words.join(" "));
  }
  return lines.join("\\n");
}

const receivers = makeAll();
const warm = readAll(receivers);
for (let round = 0; round < 200; round++) {
  if (readAll(receivers) !== warm || readAll(makeAll()) !== warm) throw new Error("the reads changed by themselves in round " + round);
}
console.log(warm);

const steps = [
  ["the ${b}; }],
  ["the ${c} }],
  ["the ${d} }],
  ["the ${e} }],
];
for (const [what, change] of steps) {
  change();
  console.log("\\n--- " + what);
  for (let round = 0; round < 40; round++) {
    const now = readAll(receivers);
    const fresh = readAll(makeAll());
    if (round === 0 || round === 39) console.log(now + "\\n- new objects\\n" + fresh);
  }
}
`,
    ),
    ...family(
      `warm-reads-below-crowded-objects-then-a-name-is-added-above.js	bove them get names	top gets a name", () => { top.added = "top.added"	middle gets the name too", () => { middle.added = "middle.added";	middle gets a name that hides the top's", () => { middle.value = "middle.value";	prototype of a constructor function gets a name", () => { Old.prototype.added = "Old.added";
warm-reads-below-crowded-objects-then-a-name-is-deleted-above.js	bove them lose names	middle loses what hid the top's", () => { delete middle.hidden	top loses it too", () => { delete top.hidden;	top loses a value", () => { delete top.value;	prototype of a constructor function loses its method and its value", () => { delete Old.prototype.method; delete Old.prototype.value;
warm-reads-below-crowded-objects-then-objects-are-frozen.js	re frozen, sealed and closed	top is frozen", () => { Object.freeze(top)	middle is sealed", () => { Object.seal(middle);	receivers take no more properties", () => { for (const [, receiver] of receivers) Object.preventExtensions(receiver);	receivers are frozen", () => { for (const [, receiver] of receivers) Object.freeze(receiver);
warm-reads-below-crowded-objects-then-the-storage-above-grows.js	bove them get so many names that what they had moves to other storage	top gets seven names", () => { for (let i = 0; i < 7; i++) top["t" + i + unknown] = i	top gets forty more, the reads go on in between", () => { for (let i = 7; i < 47; i++) { top["t" + i + unknown] = i; for (const [, receiver] of receivers) if (readers.own(receiver) !== "own" || (readers.middleOnly(receiver) !== undefined && readers.value(receiver) !== "top.value")) throw new Error("wrong behind " + i); }	middle and the prototype of a constructor function get forty", () => { for (let i = 0; i < 40; i++) { middle["m" + i + unknown] = i; Old.prototype["o" + i + unknown] = i; }	prototype objects of the classes get forty", () => { for (let i = 0; i < 40; i++) { Base.prototype["b" + i + unknown] = i; Derived.prototype["d" + i + unknown] = i; }`,
      (a, b, c, d, e) => `"use strict";
// Below objects with ninety names more each: reads by name of many kinds of receivers at sites that see them all, 200 times over; then objects a${a}; then the same reads again, of the same objects and of new ones.
const unknown = String(process.argv.length > 99 ? process.argv[99] : "");
class Base {
  constructor() {
    this.own = "own";
  }
  method() {
    return "Base.method";
  }
  shared() {
    return "Base.shared";
  }
  get getter() {
    return "Base.getter";
  }
}
class Derived extends Base {
  method() {
    return "Derived.method";
  }
}
class OtherBase {
  shared() {
    return "OtherBase.shared";
  }
  added() {
    return "OtherBase.added";
  }
}
function Old() {
  this.own = "own";
}
Old.prototype.method = function oldMethod() {};
Old.prototype.value = "Old.value";
const top = { value: "top.value", hidden: "top.hidden", method: function topMethod() {} };
const middle = Object.setPrototypeOf({ hidden: "middle.hidden", middleOnly: "middle.only" }, top);
const otherTop = { value: "otherTop.value", added: "otherTop.added" };
for (const crowded of [top, otherTop, Old.prototype]) for (let i = 0; i < 90; i++) crowded["filler" + i + unknown] = i;
const makers = {
  parsed: () => Object.setPrototypeOf(JSON.parse('{"own":"own","n":1}'), middle),
  created: () => Object.assign(Object.create(middle), { own: "own" }),
  belowTop: () => Object.defineProperty(Object.assign(Object.create(top), { own: "own" }), "hidden", { value: "own hidden", writable: true, enumerable: true, configurable: true }),
  plain: () => JSON.parse('{"own":"own"}'),
  instance: () => new Derived(),
  base: () => new Base(),
  instanceWithMore: () => Object.assign(new Derived(), { ["more" + unknown]: 1 }),
  old: () => new Old(),
  literal: () => ({ own: "own", value: "literal.value" }),
  bare: () => Object.assign(Object.create(null), { own: "own" }),
};
const readers = {
  own: o => o.own,
  value: o => o.value,
  hidden: o => o.hidden,
  middleOnly: o => o.middleOnly,
  method: o => o.method,
  shared: o => o.shared,
  getter: o => o.getter,
  added: o => o.added,
  toString: o => o.toString,
  constructor: o => o.constructor,
  zero: o => o[0],
  zeroAsText: o => o["0"],
  proto: o => o.__proto__ === Object.getPrototypeOf(o),
};
const show = value => (typeof value === "function" ? "function " + value.name : String(value));
const makeAll = () => Object.entries(makers).map(([kind, make]) => [kind, make()]);
function readAll(receivers) {
  const lines = [];
  for (const [kind, receiver] of receivers) {
    const words = [];
    for (const name in readers) words.push(name + "=" + show(readers[name](receiver)));
    lines.push(kind + ": " + words.join(" "));
  }
  return lines.join("\\n");
}

const receivers = makeAll();
const warm = readAll(receivers);
for (let round = 0; round < 200; round++) {
  if (readAll(receivers) !== warm || readAll(makeAll()) !== warm) throw new Error("the reads changed by themselves in round " + round);
}
console.log(warm);

const steps = [
  ["the ${b}; }],
  ["the ${c} }],
  ["the ${d} }],
  ["the ${e} }],
];
for (const [what, change] of steps) {
  change();
  console.log("\\n--- " + what);
  for (let round = 0; round < 40; round++) {
    const now = readAll(receivers);
    const fresh = readAll(makeAll());
    if (round === 0 || round === 39) console.log(now + "\\n- new objects\\n" + fresh);
  }
}
`,
    ),
    ...family(
      `warm-reads-of-crowded-receivers-then-a-name-is-added-above.js	bove them get names	top gets a name", () => { top.added = "top.added"	middle gets the name too", () => { middle.added = "middle.added";	middle gets a name that hides the top's", () => { middle.value = "middle.value";	prototype of a constructor function gets a name", () => { Old.prototype.added = "Old.added";
warm-reads-of-crowded-receivers-then-a-name-is-deleted-above.js	bove them lose names	middle loses what hid the top's", () => { delete middle.hidden	top loses it too", () => { delete top.hidden;	top loses a value", () => { delete top.value;	prototype of a constructor function loses its method and its value", () => { delete Old.prototype.method; delete Old.prototype.value;
warm-reads-of-crowded-receivers-then-objects-are-frozen.js	re frozen, sealed and closed	top is frozen", () => { Object.freeze(top)	middle is sealed", () => { Object.seal(middle);	receivers take no more properties", () => { for (const [, receiver] of receivers) Object.preventExtensions(receiver);	receivers are frozen", () => { for (const [, receiver] of receivers) Object.freeze(receiver);
warm-reads-of-crowded-receivers-then-the-storage-above-grows.js	bove them get so many names that what they had moves to other storage	top gets seven names", () => { for (let i = 0; i < 7; i++) top["t" + i + unknown] = i	top gets forty more, the reads go on in between", () => { for (let i = 7; i < 47; i++) { top["t" + i + unknown] = i; for (const [, receiver] of receivers) if (readers.own(receiver) !== "own" || (readers.middleOnly(receiver) !== undefined && readers.value(receiver) !== "top.value")) throw new Error("wrong behind " + i); }	middle and the prototype of a constructor function get forty", () => { for (let i = 0; i < 40; i++) { middle["m" + i + unknown] = i; Old.prototype["o" + i + unknown] = i; }	prototype objects of the classes get forty", () => { for (let i = 0; i < 40; i++) { Base.prototype["b" + i + unknown] = i; Derived.prototype["d" + i + unknown] = i; }`,
      (a, b, c, d, e) => `"use strict";
// Each receiver has forty names more of its own: reads by name of many kinds of receivers at sites that see them all, 200 times over; then objects a${a}; then the same reads again, of the same objects and of new ones.
const unknown = String(process.argv.length > 99 ? process.argv[99] : "");
class Base {
  constructor() {
    this.own = "own";
  }
  method() {
    return "Base.method";
  }
  shared() {
    return "Base.shared";
  }
  get getter() {
    return "Base.getter";
  }
}
class Derived extends Base {
  method() {
    return "Derived.method";
  }
}
class OtherBase {
  shared() {
    return "OtherBase.shared";
  }
  added() {
    return "OtherBase.added";
  }
}
function Old() {
  this.own = "own";
}
Old.prototype.method = function oldMethod() {};
Old.prototype.value = "Old.value";
const top = { value: "top.value", hidden: "top.hidden", method: function topMethod() {} };
const middle = Object.setPrototypeOf({ hidden: "middle.hidden", middleOnly: "middle.only" }, top);
const otherTop = { value: "otherTop.value", added: "otherTop.added" };
const makers = {
  parsed: () => Object.setPrototypeOf(JSON.parse('{"own":"own","n":1}'), middle),
  created: () => Object.assign(Object.create(middle), { own: "own" }),
  belowTop: () => Object.defineProperty(Object.assign(Object.create(top), { own: "own" }), "hidden", { value: "own hidden", writable: true, enumerable: true, configurable: true }),
  plain: () => JSON.parse('{"own":"own"}'),
  instance: () => new Derived(),
  base: () => new Base(),
  instanceWithMore: () => Object.assign(new Derived(), { ["more" + unknown]: 1 }),
  old: () => new Old(),
  literal: () => ({ own: "own", value: "literal.value" }),
  bare: () => Object.assign(Object.create(null), { own: "own" }),
};
for (const kind of Object.keys(makers)) {
  const make = makers[kind];
  makers[kind] = () => {
    const made = make();
    for (let i = 0; i < 40; i++) made["filler" + i + unknown] = i;
    return made;
  };
}
const readers = {
  own: o => o.own,
  value: o => o.value,
  hidden: o => o.hidden,
  middleOnly: o => o.middleOnly,
  method: o => o.method,
  shared: o => o.shared,
  getter: o => o.getter,
  added: o => o.added,
  toString: o => o.toString,
  constructor: o => o.constructor,
  zero: o => o[0],
  zeroAsText: o => o["0"],
  proto: o => o.__proto__ === Object.getPrototypeOf(o),
};
const show = value => (typeof value === "function" ? "function " + value.name : String(value));
const makeAll = () => Object.entries(makers).map(([kind, make]) => [kind, make()]);
function readAll(receivers) {
  const lines = [];
  for (const [kind, receiver] of receivers) {
    const words = [];
    for (const name in readers) words.push(name + "=" + show(readers[name](receiver)));
    lines.push(kind + ": " + words.join(" "));
  }
  return lines.join("\\n");
}

const receivers = makeAll();
const warm = readAll(receivers);
for (let round = 0; round < 200; round++) {
  if (readAll(receivers) !== warm || readAll(makeAll()) !== warm) throw new Error("the reads changed by themselves in round " + round);
}
console.log(warm);

const steps = [
  ["the ${b}; }],
  ["the ${c} }],
  ["the ${d} }],
  ["the ${e} }],
];
for (const [what, change] of steps) {
  change();
  console.log("\\n--- " + what);
  for (let round = 0; round < 40; round++) {
    const now = readAll(receivers);
    const fresh = readAll(makeAll());
    if (round === 0 || round === 39) console.log(now + "\\n- new objects\\n" + fresh);
  }
}
`,
    ),
    "objects-get-hundreds-of-properties-by-name-and-are-read-on-the-way.js": text(
      `// Sixty objects that are born empty get 260 properties each by name, as the exports of a CommonJS module do, and are read in between, so that many of the shapes on the way are asked for
const born = () => JSON.parse('{}');
let sum = 0;
function fill0(e) {`,
      [
        `3705 = 0	4585 = 1	3814 = 2	3701 = 3	4160 = 4	4811 = 5	1555 = 6	1512 = 7	4193 = 8	3897 = 9	1525 = 10	771 = 11	3658 = 12	4160 + e.k3814 + (e.k1659
2485 = 13	1161 = 14	742 = 15	4412 = 16	343 = 17	4877 = 18	3245 = 19	3710 = 20	1290 = 21	122 = 22	4328 = 23	517 = 24	487 = 25	4412 + e.k4811 + (e.k2805
292 = 26	1558 = 27	1981 = 28	4912 = 29	246 = 30	3800 = 31	2672 = 32	3608 = 33	4841 = 34	1600 = 35	4252 = 36	1914 = 37	2409 = 38	1981 + e.k3800 + (e.k1978
4094 = 39	37 = 40	696 = 41	3746 = 42	2278 = 43	3332 = 44	4515 = 45	681 = 46	2080 = 47	2582 = 48	1881 = 49	4201 = 50	2367 = 51	3710 + e.k487 + (e.k2052
243 = 52	575 = 53	4613 = 54	884 = 55	3280 = 56	883 = 57	2383 = 58	3166 = 59	547 = 60	138 = 61	4 = 62	1749 = 63	1718 = 64	487 + e.k884 + (e.k1640
428 = 65	3850 = 66	3075 = 67	3255 = 68	3438 = 69	598 = 70	4638 = 71	1626 = 72	2210 = 73	2759 = 74	713 = 75	2549 = 76	2724 = 77	1558 + e.k1881 + (e.k1798
124 = 78	3359 = 79	966 = 80	1102 = 81	2018 = 82	827 = 83	89 = 84	490 = 85	3808 = 86	3988 = 87	1455 = 88	4581 = 89	1543 = 90	2759 + e.k37 + (e.k1719
3665 = 91	4168 = 92	1562 = 93	1072 = 94	3434 = 95	3143 = 96	954 = 97	3234 = 98	3446 = 99	1743 = 100	3 = 101	4855 = 102	2491 = 103	343 + e.k343 + (e.k4067
160 = 104	1726 = 105	1534 = 106	3229 = 107	4931 = 108	4726 = 109	821 = 110	344 = 111	1198 = 112	1746 = 113	3617 = 114	2115 = 115	78 = 116	3332 + e.k3229 + (e.k332
4999 = 117	2694 = 118	2427 = 119	3163 = 120	601 = 121	608 = 122	738 = 123	1709 = 124	4773 = 125	1990 = 126	127 = 127	4925 = 128	3020 = 129	4412 + e.k598 + (e.k1385
3044 = 130	3712 = 131	1042 = 132	4810 = 133	3962 = 134	4706 = 135	1111 = 136	3162 = 137	1497 = 138	1262 = 139	2546 = 140	1870 = 141	2043 = 142	1981 + e.k2115 + (e.k3861
1554 = 143	1298 = 144	4537 = 145	1610 = 146	3180 = 147	3952 = 148	4944 = 149	643 = 150	3452 = 151	388 = 152	850 = 153	893 = 154	317 = 155	598 + e.k4613 + (e.k3391
4197 = 156	2090 = 157	1953 = 158	3208 = 159	2105 = 160	3447 = 161	4886 = 162	4022 = 163	2403 = 164	4260 = 165	1437 = 166	563 = 167	1035 = 168	954 + e.k2105 + (e.k4259
1871 = 169	3926 = 170	4582 = 171	607 = 172	2295 = 173	1739 = 174	1670 = 175	135 = 176	566 = 177	2205 = 178	3370 = 179	3651 = 180	2040 = 181	1990 + e.k607 + (e.k2583
495 = 182	381 = 183	1443 = 184	2309 = 185	3021 = 186	4349 = 187	4687 = 188	1077 = 189	755 = 190	2966 = 191	1133 = 192	3689 = 193	2711 = 194	381 + e.k3208 + (e.k3706
4275 = 195	4787 = 196	1149 = 197	4832 = 198	287 = 199	146 = 200	3889 = 201	2928 = 202	2554 = 203	274 = 204	174 = 205	4901 = 206	613 = 207	2018 + e.k3245 + (e.k257
3950 = 208	551 = 209	2548 = 210	2612 = 211	1119 = 212	593 = 213	616 = 214	3711 = 215	4473 = 216	3012 = 217	364 = 218	1061 = 219	2798 = 220	4638 + e.k317 + (e.k339
2882 = 221	695 = 222	3877 = 223	636 = 224	3417 = 225	247 = 226	4095 = 227	4692 = 228	119 = 229	3132 = 230	3106 = 231	101 = 232	4987 = 233	2295 + e.k2040 + (e.k2302
591 = 234	657 = 235	946 = 236	2107 = 237	3409 = 238	2704 = 239	3182 = 240	4759 = 241	3749 = 242	3789 = 243	4433 = 244	686 = 245	4249 = 246	1610 + e.k1543 + (e.k2531
4215 = 247	244 = 248	2541 = 249	718 = 250	3939 = 251	182 = 252	1885 = 253	924 = 254	4073 = 255	3983 = 256	2095 = 257	92 = 258	3014 = 259	3897 + e.k3438 + (e.k3319`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e0 = fill0(born());
function fill1(e) {`,
      [
        `3725 = 0	1555 = 1	202 = 2	2182 = 3	1944 = 4	1154 = 5	384 = 6	944 = 7	3657 = 8	893 = 9	4385 = 10	3020 = 11	638 = 12	3657 + e.k638 + (e.k126
1622 = 13	1633 = 14	3892 = 15	2097 = 16	1463 = 17	88 = 18	3868 = 19	4381 = 20	296 = 21	1467 = 22	1855 = 23	2231 = 24	2832 = 25	4385 + e.k202 + (e.k3313
4421 = 26	4263 = 27	4099 = 28	1304 = 29	3223 = 30	1834 = 31	714 = 32	3362 = 33	3178 = 34	1064 = 35	3690 = 36	3715 = 37	1612 = 38	3690 + e.k1612 + (e.k1564
55 = 39	3086 = 40	4505 = 41	4659 = 42	4117 = 43	2810 = 44	3798 = 45	2674 = 46	1678 = 47	810 = 48	1011 = 49	1747 = 50	1984 = 51	714 + e.k3715 + (e.k2793
3196 = 52	719 = 53	2538 = 54	4398 = 55	2624 = 56	2145 = 57	128 = 58	2854 = 59	4134 = 60	678 = 61	304 = 62	3611 = 63	2802 = 64	3362 + e.k1064 + (e.k952
4508 = 65	3452 = 66	2254 = 67	3993 = 68	232 = 69	1788 = 70	524 = 71	3513 = 72	287 = 73	1416 = 74	4367 = 75	2744 = 76	1150 = 77	4381 + e.k1984 + (e.k1091
3854 = 78	1217 = 79	4231 = 80	4245 = 81	3605 = 82	4035 = 83	4742 = 84	704 = 85	1813 = 86	3599 = 87	4314 = 88	4577 = 89	2377 = 90	4659 + e.k3993 + (e.k3029
4600 = 91	1346 = 92	4282 = 93	4212 = 94	4587 = 95	2101 = 96	2553 = 97	3122 = 98	4992 = 99	1705 = 100	2494 = 101	1156 = 102	4462 = 103	3122 + e.k4398 + (e.k1487
4294 = 104	2236 = 105	4693 = 106	4076 = 107	1646 = 108	3367 = 109	4390 = 110	936 = 111	4122 = 112	40 = 113	4958 = 114	3088 = 115	227 = 116	1984 + e.k4421 + (e.k1514
4409 = 117	360 = 118	4227 = 119	3281 = 120	4456 = 121	4611 = 122	998 = 123	4022 = 124	763 = 125	1366 = 126	539 = 127	4413 = 128	3759 = 129	88 + e.k3599 + (e.k2471
3389 = 130	3310 = 131	2205 = 132	2017 = 133	3876 = 134	4038 = 135	1040 = 136	2782 = 137	3552 = 138	3903 = 139	4300 = 140	2598 = 141	889 = 142	3281 + e.k2832 + (e.k86
1568 = 143	3436 = 144	240 = 145	2131 = 146	1060 = 147	186 = 148	291 = 149	1590 = 150	1274 = 151	1861 = 152	96 = 153	2327 = 154	2638 = 155	4600 + e.k638 + (e.k1901
2911 = 156	2002 = 157	4086 = 158	859 = 159	4093 = 160	4769 = 161	1005 = 162	4181 = 163	2052 = 164	1619 = 165	4344 = 166	3578 = 167	190 = 168	232 + e.k2744 + (e.k2767
3078 = 169	3386 = 170	4336 = 171	1308 = 172	4408 = 173	1673 = 174	4374 = 175	4338 = 176	1770 = 177	4447 = 178	4805 = 179	1117 = 180	1905 = 181	4398 + e.k190 + (e.k3327
2847 = 182	1483 = 183	2587 = 184	4940 = 185	2580 = 186	1594 = 187	1787 = 188	1593 = 189	793 = 190	1097 = 191	1960 = 192	1085 = 193	722 = 194	240 + e.k2674 + (e.k4366
2125 = 195	3177 = 196	794 = 197	3561 = 198	3453 = 199	4450 = 200	1032 = 201	1643 = 202	3299 = 203	145 = 204	786 = 205	4668 = 206	2929 = 207	3868 + e.k4992 + (e.k4216
2959 = 208	945 = 209	4142 = 210	2813 = 211	4118 = 212	1548 = 213	577 = 214	3949 = 215	869 = 216	199 = 217	306 = 218	4519 = 219	4217 = 220	539 + e.k2052 + (e.k1746
3942 = 221	1200 = 222	1552 = 223	1511 = 224	941 = 225	1670 = 226	1413 = 227	1294 = 228	2319 = 229	780 = 230	4749 = 231	507 = 232	1101 = 233	4805 + e.k3223 + (e.k3238
3785 = 234	635 = 235	792 = 236	2677 = 237	3202 = 238	3825 = 239	3493 = 240	4221 = 241	2904 = 242	3523 = 243	1721 = 244	4922 = 245	3056 = 246	1060 + e.k1154 + (e.k940
108 = 247	334 = 248	1640 = 249	1484 = 250	3341 = 251	3718 = 252	2945 = 253	3032 = 254	3320 = 255	1598 = 256	4955 = 257	1352 = 258	776 = 259	4398 + e.k4456 + (e.k2102`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e1 = fill1(born());
function fill2(e) {`,
      [
        `3634 = 0	3289 = 1	4135 = 2	413 = 3	1601 = 4	3077 = 5	88 = 6	806 = 7	2118 = 8	2055 = 9	2258 = 10	2792 = 11	4506 = 12	3634 + e.k4506 + (e.k3096
4427 = 13	4160 = 14	3405 = 15	4265 = 16	4652 = 17	816 = 18	3640 = 19	624 = 20	4500 = 21	4895 = 22	369 = 23	3165 = 24	1310 = 25	4135 + e.k4160 + (e.k4434
3161 = 26	3864 = 27	1385 = 28	4059 = 29	4439 = 30	4887 = 31	479 = 32	3519 = 33	4051 = 34	3446 = 35	2330 = 36	4315 = 37	3265 = 38	3289 + e.k3519 + (e.k2965
4897 = 39	2559 = 40	2994 = 41	4345 = 42	2340 = 43	3958 = 44	2209 = 45	4592 = 46	2322 = 47	2425 = 48	220 = 49	114 = 50	2007 = 51	2209 + e.k3634 + (e.k900
4798 = 52	350 = 53	1282 = 54	3348 = 55	3194 = 56	432 = 57	2581 = 58	3258 = 59	410 = 60	4765 = 61	2615 = 62	602 = 63	1832 = 64	350 + e.k350 + (e.k1197
3518 = 65	3912 = 66	1996 = 67	372 = 68	4287 = 69	3836 = 70	1182 = 71	2008 = 72	4944 = 73	942 = 74	412 = 75	3417 = 76	3733 = 77	4887 + e.k624 + (e.k3076
966 = 78	1668 = 79	426 = 80	2922 = 81	4326 = 82	1267 = 83	1018 = 84	2976 = 85	3627 = 86	1145 = 87	3415 = 88	3731 = 89	4923 = 90	1145 + e.k4500 + (e.k2628
2147 = 91	4769 = 92	3436 = 93	2982 = 94	4348 = 95	1122 = 96	2376 = 97	1055 = 98	1953 = 99	3941 = 100	932 = 101	4120 = 102	2528 = 103	3161 + e.k220 + (e.k3481
4156 = 104	2942 = 105	2250 = 106	2224 = 107	4995 = 108	4627 = 109	4847 = 110	1556 = 111	2282 = 112	1961 = 113	1554 = 114	2039 = 115	4113 = 116	1996 + e.k4315 + (e.k2244
1605 = 117	323 = 118	497 = 119	77 = 120	2219 = 121	2125 = 122	3483 = 123	311 = 124	839 = 125	1823 = 126	4437 = 127	2279 = 128	593 = 129	3405 + e.k77 + (e.k2526
708 = 130	1317 = 131	4510 = 132	1923 = 133	3057 = 134	3965 = 135	3920 = 136	2900 = 137	1725 = 138	2770 = 139	2815 = 140	4050 = 141	1092 = 142	4059 + e.k3733 + (e.k1273
609 = 143	981 = 144	3664 = 145	1746 = 146	3476 = 147	2114 = 148	3195 = 149	1234 = 150	3022 = 151	1257 = 152	2665 = 153	2382 = 154	4494 = 155	2209 + e.k3405 + (e.k3758
1506 = 156	3503 = 157	3024 = 158	4756 = 159	794 = 160	3784 = 161	2655 = 162	643 = 163	4453 = 164	680 = 165	3538 = 166	4622 = 167	3971 = 168	1601 + e.k3195 + (e.k3940
3797 = 169	2448 = 170	76 = 171	623 = 172	2540 = 173	1747 = 174	4945 = 175	669 = 176	2488 = 177	4053 = 178	2686 = 179	2317 = 180	1170 = 181	2055 + e.k426 + (e.k890
1792 = 182	2931 = 183	2679 = 184	3001 = 185	961 = 186	2641 = 187	3612 = 188	4663 = 189	4872 = 190	2287 = 191	3588 = 192	4343 = 193	2496 = 194	114 + e.k2322 + (e.k2943
3754 = 195	2601 = 196	1812 = 197	3273 = 198	4228 = 199	2034 = 200	690 = 201	2962 = 202	197 = 203	3240 = 204	4790 = 205	3175 = 206	1597 = 207	3348 + e.k1234 + (e.k1928
4618 = 208	3016 = 209	3196 = 210	4428 = 211	1268 = 212	4842 = 213	4610 = 214	1452 = 215	1446 = 216	735 = 217	3722 = 218	2305 = 219	182 = 220	2665 + e.k2931 + (e.k3865
4224 = 221	472 = 222	4457 = 223	1299 = 224	4648 = 225	2423 = 226	183 = 227	3463 = 228	524 = 229	4767 = 230	4479 = 231	2502 = 232	4468 = 233	1257 + e.k708 + (e.k1834
688 = 234	2740 = 235	2241 = 236	863 = 237	2570 = 238	693 = 239	212 = 240	1178 = 241	798 = 242	3457 = 243	2010 = 244	1805 = 245	4005 = 246	1961 + e.k2322 + (e.k2302
4272 = 247	3760 = 248	3230 = 249	2870 = 250	2767 = 251	2727 = 252	1119 = 253	4044 = 254	3998 = 255	4401 = 256	378 = 257	3363 = 258	2860 = 259	3175 + e.k3415 + (e.k2553`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e2 = fill2(born());
function fill3(e) {`,
      [
        `4491 = 0	4508 = 1	3927 = 2	2133 = 3	3971 = 4	3298 = 5	2802 = 6	4483 = 7	757 = 8	3953 = 9	1810 = 10	3272 = 11	407 = 12	3953 + e.k3272 + (e.k4626
1781 = 13	1100 = 14	3153 = 15	4321 = 16	4225 = 17	2249 = 18	474 = 19	1946 = 20	89 = 21	3871 = 22	3043 = 23	3686 = 24	2019 = 25	3686 + e.k1781 + (e.k2306
3452 = 26	4964 = 27	1288 = 28	3406 = 29	1285 = 30	2636 = 31	1185 = 32	2125 = 33	4228 = 34	1074 = 35	2183 = 36	4226 = 37	4379 = 38	2636 + e.k3406 + (e.k3350
433 = 39	1234 = 40	4684 = 41	1460 = 42	11 = 43	1673 = 44	1220 = 45	1051 = 46	675 = 47	2881 = 48	2211 = 49	4324 = 50	795 = 51	4964 + e.k4483 + (e.k4636
3932 = 52	3839 = 53	678 = 54	4805 = 55	4451 = 56	4144 = 57	2487 = 58	155 = 59	1538 = 60	3415 = 61	1581 = 62	745 = 63	3606 = 64	1100 + e.k1460 + (e.k4300
1707 = 65	304 = 66	3384 = 67	4306 = 68	4048 = 69	1290 = 70	2551 = 71	2589 = 72	2545 = 73	3321 = 74	622 = 75	4557 = 76	2504 = 77	304 + e.k4805 + (e.k3443
3827 = 78	549 = 79	2946 = 80	609 = 81	1151 = 82	866 = 83	3229 = 84	3782 = 85	998 = 86	3647 = 87	101 = 88	3089 = 89	3893 = 90	2133 + e.k4684 + (e.k447
1945 = 91	2404 = 92	4621 = 93	928 = 94	3752 = 95	85 = 96	1693 = 97	1246 = 98	2378 = 99	3080 = 100	4421 = 101	2442 = 102	2763 = 103	4226 + e.k2404 + (e.k3548
3212 = 104	4551 = 105	712 = 106	2100 = 107	1545 = 108	1637 = 109	3084 = 110	897 = 111	2698 = 112	2537 = 113	2243 = 114	4610 = 115	3848 = 116	4621 + e.k2881 + (e.k4894
2716 = 117	3660 = 118	3132 = 119	755 = 120	834 = 121	1153 = 122	773 = 123	1076 = 124	1468 = 125	1473 = 126	1582 = 127	3295 = 128	298 = 129	1151 + e.k3827 + (e.k4861
3794 = 130	4855 = 131	738 = 132	822 = 133	1856 = 134	265 = 135	1286 = 136	1016 = 137	3553 = 138	3332 = 139	595 = 140	2798 = 141	3498 = 142	4225 + e.k1581 + (e.k1019
4190 = 143	1139 = 144	1683 = 145	1212 = 146	3161 = 147	3954 = 148	2714 = 149	3376 = 150	126 = 151	3282 = 152	2602 = 153	2007 = 154	4985 = 155	2243 + e.k1581 + (e.k4117
4340 = 156	151 = 157	2135 = 158	2711 = 159	1546 = 160	2803 = 161	2513 = 162	3614 = 163	870 = 164	4564 = 165	3093 = 166	1678 = 167	4172 = 168	4421 + e.k1781 + (e.k3897
2725 = 169	841 = 170	1297 = 171	2079 = 172	4414 = 173	2445 = 174	1916 = 175	2888 = 176	4099 = 177	4206 = 178	1161 = 179	4703 = 180	1623 = 181	4099 + e.k3452 + (e.k4310
4227 = 182	1615 = 183	4647 = 184	218 = 185	1621 = 186	681 = 187	1116 = 188	2003 = 189	3914 = 190	4722 = 191	3420 = 192	2732 = 193	2696 = 194	3415 + e.k3332 + (e.k2509
751 = 195	2958 = 196	2180 = 197	3793 = 198	3705 = 199	1110 = 200	1954 = 201	4663 = 202	4474 = 203	4593 = 204	520 = 205	4590 = 206	2165 = 207	4172 + e.k4421 + (e.k1932
1380 = 208	2741 = 209	4927 = 210	1193 = 211	1004 = 212	31 = 213	2364 = 214	2978 = 215	1973 = 216	4698 = 217	2974 = 218	1358 = 219	1520 = 220	4225 + e.k681 + (e.k3020
4895 = 221	4488 = 222	624 = 223	3722 = 224	262 = 225	3304 = 226	1475 = 227	1132 = 228	2520 = 229	3126 = 230	4848 = 231	133 = 232	1298 = 233	4895 + e.k3332 + (e.k3452
1634 = 234	3375 = 235	3834 = 236	270 = 237	1171 = 238	3165 = 239	968 = 240	4665 = 241	3323 = 242	1422 = 243	2754 = 244	4257 = 245	1077 = 246	1139 + e.k4590 + (e.k1344
2159 = 247	1999 = 248	4653 = 249	2720 = 250	438 = 251	310 = 252	3302 = 253	4075 = 254	4915 = 255	839 = 256	3849 = 257	2829 = 258	3370 = 259	2537 + e.k2978 + (e.k4643`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e3 = fill3(born());
function fill4(e) {`,
      [
        `1004 = 0	587 = 1	807 = 2	4256 = 3	1064 = 4	1014 = 5	4403 = 6	4717 = 7	3712 = 8	4 = 9	2425 = 10	1998 = 11	2451 = 12	4717 + e.k4717 + (e.k4015
195 = 13	2660 = 14	1409 = 15	513 = 16	3610 = 17	3686 = 18	4345 = 19	3254 = 20	1157 = 21	2920 = 22	4796 = 23	1890 = 24	375 = 25	3254 + e.k1157 + (e.k1487
2508 = 26	255 = 27	3726 = 28	2570 = 29	2521 = 30	2657 = 31	4083 = 32	1173 = 33	3871 = 34	1691 = 35	1660 = 36	2419 = 37	483 = 38	2657 + e.k195 + (e.k4426
1601 = 39	2587 = 40	2901 = 41	3870 = 42	131 = 43	1408 = 44	4586 = 45	1654 = 46	4367 = 47	1935 = 48	1568 = 49	409 = 50	869 = 51	1890 + e.k2508 + (e.k596
2507 = 52	2563 = 53	2243 = 54	3443 = 55	1104 = 56	2743 = 57	3646 = 58	3401 = 59	647 = 60	1387 = 61	1828 = 62	2516 = 63	988 = 64	4403 + e.k1691 + (e.k2972
1609 = 65	2203 = 66	1482 = 67	1928 = 68	4107 = 69	2420 = 70	2238 = 71	3051 = 72	4295 = 73	948 = 74	4832 = 75	4226 = 76	1875 = 77	1691 + e.k807 + (e.k4250
2465 = 78	1479 = 79	1850 = 80	2267 = 81	1085 = 82	737 = 83	3790 = 84	624 = 85	3607 = 86	4327 = 87	604 = 88	4348 = 89	371 = 90	4796 + e.k1173 + (e.k4195
57 = 91	4912 = 92	4805 = 93	2330 = 94	4401 = 95	2055 = 96	3468 = 97	4657 = 98	714 = 99	1347 = 100	2335 = 101	1552 = 102	2014 = 103	409 + e.k3051 + (e.k1782
1469 = 104	2286 = 105	4490 = 106	236 = 107	1526 = 108	1235 = 109	275 = 110	3781 = 111	4791 = 112	3151 = 113	21 = 114	4095 = 115	493 = 116	3871 + e.k195 + (e.k2958
1473 = 117	524 = 118	4554 = 119	2946 = 120	2628 = 121	3960 = 122	261 = 123	4233 = 124	2387 = 125	4142 = 126	4264 = 127	4355 = 128	1424 = 129	2660 + e.k1601 + (e.k2946
4865 = 130	1353 = 131	918 = 132	4981 = 133	3568 = 134	1927 = 135	3608 = 136	4487 = 137	2098 = 138	1932 = 139	2127 = 140	4006 = 141	4457 = 142	1691 + e.k1387 + (e.k976
1812 = 143	4752 = 144	4942 = 145	4087 = 146	2140 = 147	289 = 148	1658 = 149	4889 = 150	430 = 151	4691 = 152	3673 = 153	1474 = 154	2662 = 155	1014 + e.k1085 + (e.k3149
1243 = 156	4983 = 157	145 = 158	4985 = 159	4064 = 160	3560 = 161	4126 = 162	3618 = 163	2154 = 164	253 = 165	594 = 166	936 = 167	1459 = 168	4095 + e.k1157 + (e.k3124
4660 = 169	4450 = 170	4747 = 171	1949 = 172	1197 = 173	442 = 174	2547 = 175	3484 = 176	346 = 177	2575 = 178	4304 = 179	2168 = 180	4822 = 181	737 + e.k1609 + (e.k4254
4082 = 182	724 = 183	4182 = 184	1405 = 185	3103 = 186	2087 = 187	2032 = 188	1309 = 189	4070 = 190	4881 = 191	3723 = 192	500 = 193	3363 = 194	4747 + e.k2660 + (e.k2475
3824 = 195	2985 = 196	1772 = 197	345 = 198	1051 = 199	4010 = 200	4921 = 201	1102 = 202	1184 = 203	3729 = 204	4273 = 205	321 = 206	27 = 207	1347 + e.k2662 + (e.k1952
1971 = 208	3357 = 209	4305 = 210	1159 = 211	748 = 212	3218 = 213	4555 = 214	2441 = 215	3865 = 216	3477 = 217	626 = 218	280 = 219	1883 = 220	2387 + e.k2425 + (e.k1537
2422 = 221	2074 = 222	973 = 223	4521 = 224	1979 = 225	3427 = 226	704 = 227	1861 = 228	2981 = 229	2529 = 230	2761 = 231	1788 = 232	325 = 233	483 + e.k1353 + (e.k4877
1314 = 234	3301 = 235	4794 = 236	479 = 237	2811 = 238	4648 = 239	4838 = 240	1452 = 241	3789 = 242	1747 = 243	3122 = 244	3102 = 245	403 = 246	4083 + e.k3712 + (e.k1708
1764 = 247	3428 = 248	2845 = 249	2019 = 250	1504 = 251	4501 = 252	1342 = 253	3933 = 254	1668 = 255	3278 = 256	1756 = 257	3831 = 258	2527 = 259	4985 + e.k4305 + (e.k3473`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e4 = fill4(born());
function fill5(e) {`,
      [
        `3920 = 0	4456 = 1	1114 = 2	4234 = 3	4490 = 4	2133 = 5	2571 = 6	3700 = 7	3088 = 8	1205 = 9	1677 = 10	2296 = 11	4382 = 12	1114 + e.k4490 + (e.k3278
3681 = 13	3320 = 14	1119 = 15	3166 = 16	4233 = 17	2913 = 18	1851 = 19	840 = 20	2392 = 21	3034 = 22	2825 = 23	1767 = 24	1149 = 25	3088 + e.k1677 + (e.k1864
333 = 26	200 = 27	3955 = 28	4636 = 29	93 = 30	2441 = 31	548 = 32	1771 = 33	4572 = 34	2894 = 35	1000 = 36	3065 = 37	1921 = 38	2133 + e.k93 + (e.k1647
2126 = 39	736 = 40	3503 = 41	981 = 42	3214 = 43	4037 = 44	492 = 45	4013 = 46	3140 = 47	2688 = 48	2331 = 49	4072 = 50	2292 = 51	2825 + e.k2894 + (e.k2126
1815 = 52	1299 = 53	3296 = 54	1654 = 55	3893 = 56	1365 = 57	2873 = 58	1964 = 59	4263 = 60	762 = 61	2800 = 62	3459 = 63	1235 = 64	2571 + e.k1851 + (e.k527
3918 = 65	4772 = 66	2105 = 67	4531 = 68	2527 = 69	188 = 70	3206 = 71	985 = 72	2984 = 73	515 = 74	3312 = 75	2228 = 76	447 = 77	3920 + e.k2126 + (e.k642
3089 = 78	4059 = 79	4799 = 80	2457 = 81	3841 = 82	2666 = 83	2075 = 84	592 = 85	192 = 86	289 = 87	2843 = 88	2650 = 89	3057 = 90	3920 + e.k2825 + (e.k2754
4634 = 91	2435 = 92	2145 = 93	1523 = 94	3844 = 95	3149 = 96	2797 = 97	2970 = 98	254 = 99	4719 = 100	1773 = 101	618 = 102	390 = 103	762 + e.k4233 + (e.k1656
4447 = 104	3366 = 105	3404 = 106	521 = 107	2262 = 108	559 = 109	3800 = 110	3682 = 111	3128 = 112	3153 = 113	312 = 114	1112 = 115	4153 = 116	3682 + e.k1815 + (e.k3967
2235 = 117	2528 = 118	4055 = 119	2952 = 120	3875 = 121	172 = 122	1227 = 123	4959 = 124	1576 = 125	2210 = 126	1871 = 127	2114 = 128	1802 = 129	3088 + e.k3404 + (e.k2878
4264 = 130	7 = 131	4454 = 132	3226 = 133	28 = 134	1960 = 135	4481 = 136	4043 = 137	647 = 138	4593 = 139	2732 = 140	2163 = 141	2839 = 142	1773 + e.k2839 + (e.k472
851 = 143	158 = 144	2567 = 145	1703 = 146	3245 = 147	1281 = 148	1574 = 149	1319 = 150	1306 = 151	2728 = 152	4019 = 153	4618 = 154	2405 = 155	1654 + e.k2732 + (e.k2067
3027 = 156	3398 = 157	2340 = 158	3005 = 159	4374 = 160	4082 = 161	1941 = 162	2042 = 163	2967 = 164	2662 = 165	1456 = 166	4208 = 167	1032 = 168	188 + e.k2688 + (e.k2382
518 = 169	562 = 170	837 = 171	2540 = 172	923 = 173	3699 = 174	4197 = 175	3937 = 176	330 = 177	1331 = 178	3380 = 179	3948 = 180	437 = 181	3459 + e.k3153 + (e.k4679
2823 = 182	2079 = 183	3255 = 184	4157 = 185	3213 = 186	2072 = 187	2062 = 188	3012 = 189	2677 = 190	1503 = 191	2734 = 192	1678 = 193	1059 = 194	4157 + e.k4382 + (e.k1440
4648 = 195	3445 = 196	1028 = 197	2203 = 198	1317 = 199	1025 = 200	1645 = 201	3087 = 202	2391 = 203	1892 = 204	1512 = 205	112 = 206	3865 = 207	2571 + e.k3214 + (e.k4415
4796 = 208	1095 = 209	2195 = 210	2220 = 211	3434 = 212	2064 = 213	3249 = 214	3167 = 215	1136 = 216	398 = 217	1288 = 218	969 = 219	347 = 220	93 + e.k2540 + (e.k611
1587 = 221	2343 = 222	2920 = 223	4411 = 224	984 = 225	3314 = 226	2703 = 227	217 = 228	4444 = 229	3957 = 230	1402 = 231	3059 = 232	551 = 233	2527 + e.k4634 + (e.k196
2532 = 234	3594 = 235	2324 = 236	1832 = 237	3208 = 238	3343 = 239	1163 = 240	4721 = 241	3189 = 242	1774 = 243	4472 = 244	2315 = 245	1203 = 246	2734 + e.k2839 + (e.k2539
3622 = 247	1434 = 248	877 = 249	4556 = 250	2059 = 251	3999 = 252	3544 = 253	986 = 254	1244 = 255	2651 = 256	157 = 257	2213 = 258	4659 = 259	548 + e.k3208 + (e.k85`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e5 = fill5(born());
function fill6(e) {`,
      [
        `1721 = 0	521 = 1	2986 = 2	90 = 3	4319 = 4	2170 = 5	2007 = 6	4054 = 7	3270 = 8	2522 = 9	4353 = 10	826 = 11	3949 = 12	4353 + e.k2522 + (e.k2004
3295 = 13	3346 = 14	2052 = 15	192 = 16	77 = 17	4725 = 18	1153 = 19	1861 = 20	2651 = 21	3181 = 22	3025 = 23	4146 = 24	2267 = 25	1721 + e.k3295 + (e.k3070
2987 = 26	3684 = 27	2900 = 28	2557 = 29	2287 = 30	546 = 31	2634 = 32	4867 = 33	771 = 34	2167 = 35	2742 = 36	1749 = 37	1475 = 38	3270 + e.k1749 + (e.k2061
1731 = 39	384 = 40	1071 = 41	4474 = 42	2494 = 43	1687 = 44	1452 = 45	2846 = 46	866 = 47	1274 = 48	1170 = 49	3053 = 50	2869 = 51	4146 + e.k2987 + (e.k2280
1493 = 52	3528 = 53	180 = 54	3274 = 55	4117 = 56	427 = 57	3304 = 58	776 = 59	2633 = 60	4400 = 61	1676 = 62	170 = 63	1430 = 64	2494 + e.k3295 + (e.k4839
2628 = 65	544 = 66	4825 = 67	887 = 68	4741 = 69	3523 = 70	3877 = 71	1799 = 72	4090 = 73	3344 = 74	1456 = 75	2239 = 76	573 = 77	3295 + e.k4741 + (e.k814
3195 = 78	2639 = 79	1502 = 80	2926 = 81	4301 = 82	82 = 83	1213 = 84	3097 = 85	453 = 86	1739 = 87	2822 = 88	3600 = 89	3473 = 90	3304 + e.k2987 + (e.k724
4135 = 91	4650 = 92	935 = 93	994 = 94	3712 = 95	3573 = 96	3827 = 97	3435 = 98	3151 = 99	4108 = 100	1884 = 101	3075 = 102	4920 = 103	1884 + e.k2846 + (e.k132
4433 = 104	4692 = 105	348 = 106	4220 = 107	263 = 108	4327 = 109	3700 = 110	3660 = 111	2327 = 112	4860 = 113	378 = 114	4870 = 115	447 = 116	866 + e.k90 + (e.k4835
2660 = 117	1244 = 118	4398 = 119	3839 = 120	2688 = 121	2097 = 122	2563 = 123	1542 = 124	3841 = 125	4519 = 126	3293 = 127	429 = 128	1037 = 129	2822 + e.k2170 + (e.k1275
4022 = 130	909 = 131	1917 = 132	1531 = 133	1166 = 134	938 = 135	853 = 136	4191 = 137	2062 = 138	2142 = 139	531 = 140	1514 = 141	313 = 142	3839 + e.k4725 + (e.k2963
2805 = 143	2053 = 144	4240 = 145	2857 = 146	3719 = 147	1699 = 148	4393 = 149	117 = 150	3496 = 151	1605 = 152	4006 = 153	2290 = 154	1954 = 155	2494 + e.k1244 + (e.k4143
602 = 156	878 = 157	4546 = 158	3608 = 159	4020 = 160	1980 = 161	591 = 162	4068 = 163	458 = 164	4499 = 165	538 = 166	1243 = 167	2997 = 168	1502 + e.k2097 + (e.k4960
1462 = 169	821 = 170	2734 = 171	301 = 172	2832 = 173	1798 = 174	2363 = 175	961 = 176	3408 = 177	1488 = 178	3183 = 179	255 = 180	3814 = 181	2052 + e.k4117 + (e.k171
4007 = 182	588 = 183	723 = 184	1693 = 185	4360 = 186	2591 = 187	1614 = 188	4587 = 189	3098 = 190	125 = 191	2781 = 192	2583 = 193	2281 = 194	1884 + e.k3700 + (e.k1883
4940 = 195	1708 = 196	1716 = 197	1480 = 198	1048 = 199	1405 = 200	4755 = 201	3821 = 202	338 = 203	1057 = 204	2279 = 205	950 = 206	2118 = 207	538 + e.k2062 + (e.k901
2818 = 208	4997 = 209	2928 = 210	2516 = 211	1606 = 212	65 = 213	565 = 214	1683 = 215	2951 = 216	2541 = 217	1639 = 218	1198 = 219	585 = 220	3346 + e.k77 + (e.k3786
2177 = 221	3479 = 222	3068 = 223	3350 = 224	3742 = 225	1095 = 226	4149 = 227	1012 = 228	778 = 229	2837 = 230	4209 = 231	3423 = 232	1925 = 233	1243 + e.k3075 + (e.k1786
4035 = 234	4745 = 235	963 = 236	2333 = 237	1009 = 238	2346 = 239	640 = 240	3726 = 241	1848 = 242	3911 = 243	3175 = 244	1627 = 245	3391 = 246	1917 + e.k4393 + (e.k1715
4925 = 247	1805 = 248	3673 = 249	525 = 250	3006 = 251	3433 = 252	2730 = 253	2304 = 254	4786 = 255	3611 = 256	2192 = 257	2399 = 258	103 = 259	2304 + e.k4587 + (e.k1171`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e6 = fill6(born());
function fill7(e) {`,
      [
        `4223 = 0	3232 = 1	785 = 2	684 = 3	29 = 4	1366 = 5	2075 = 6	3881 = 7	980 = 8	3548 = 9	3839 = 10	1276 = 11	129 = 12	1366 + e.k1276 + (e.k3365
3038 = 13	2999 = 14	198 = 15	892 = 16	2876 = 17	3382 = 18	4389 = 19	4596 = 20	4371 = 21	911 = 22	772 = 23	2470 = 24	4155 = 25	3382 + e.k3232 + (e.k2105
4620 = 26	1020 = 27	554 = 28	4652 = 29	1948 = 30	1062 = 31	723 = 32	4175 = 33	4195 = 34	2526 = 35	2408 = 36	2889 = 37	2014 = 38	29 + e.k892 + (e.k3093
2021 = 39	4839 = 40	3390 = 41	3820 = 42	444 = 43	1782 = 44	4824 = 45	3700 = 46	1394 = 47	4572 = 48	856 = 49	3763 = 50	1127 = 51	198 + e.k4824 + (e.k1747
854 = 52	4126 = 53	1268 = 54	1179 = 55	4623 = 56	4300 = 57	1422 = 58	3329 = 59	974 = 60	3386 = 61	87 = 62	1875 = 63	1259 = 64	1179 + e.k980 + (e.k4583
897 = 65	3084 = 66	1282 = 67	2409 = 68	4350 = 69	233 = 70	3317 = 71	903 = 72	4042 = 73	2463 = 74	4449 = 75	377 = 76	3192 = 77	772 + e.k854 + (e.k4350
3409 = 78	2453 = 79	641 = 80	1758 = 81	2136 = 82	4396 = 83	915 = 84	3434 = 85	2693 = 86	4005 = 87	1668 = 88	4588 = 89	1129 = 90	1422 + e.k856 + (e.k3987
4103 = 91	795 = 92	3231 = 93	2452 = 94	2190 = 95	4913 = 96	2115 = 97	1802 = 98	3013 = 99	691 = 100	3516 = 101	3906 = 102	3151 = 103	198 + e.k4652 + (e.k1525
2936 = 104	3526 = 105	2735 = 106	3693 = 107	956 = 108	406 = 109	2548 = 110	505 = 111	1337 = 112	4324 = 113	3130 = 114	4485 = 115	2643 = 116	4913 + e.k2453 + (e.k838
3274 = 117	1824 = 118	812 = 119	3046 = 120	265 = 121	2575 = 122	2945 = 123	3965 = 124	1886 = 125	4258 = 126	4316 = 127	3992 = 128	73 = 129	3409 + e.k3992 + (e.k1230
3059 = 130	3330 = 131	4860 = 132	859 = 133	57 = 134	2926 = 135	2017 = 136	2995 = 137	4899 = 138	3021 = 139	2467 = 140	1718 = 141	4990 = 142	980 + e.k1129 + (e.k4653
4828 = 143	459 = 144	2581 = 145	1504 = 146	4076 = 147	965 = 148	4228 = 149	2823 = 150	434 = 151	760 = 152	1747 = 153	2064 = 154	2212 = 155	4839 + e.k1718 + (e.k4015
3485 = 156	3058 = 157	3295 = 158	735 = 159	2341 = 160	4687 = 161	796 = 162	700 = 163	3249 = 164	1845 = 165	2050 = 166	2688 = 167	266 = 168	3434 + e.k1886 + (e.k1241
2599 = 169	1223 = 170	1277 = 171	2338 = 172	2313 = 173	464 = 174	4016 = 175	392 = 176	3237 = 177	686 = 178	4522 = 179	1134 = 180	2785 = 181	3130 + e.k4103 + (e.k2476
183 = 182	1732 = 183	4749 = 184	4479 = 185	45 = 186	3925 = 187	3427 = 188	2748 = 189	614 = 190	1412 = 191	683 = 192	3608 = 193	1147 = 194	4155 + e.k1875 + (e.k1279
3095 = 195	3667 = 196	3578 = 197	966 = 198	3645 = 199	2620 = 200	585 = 201	949 = 202	2915 = 203	4490 = 204	927 = 205	969 = 206	3253 = 207	1179 + e.k1127 + (e.k4382
2539 = 208	4589 = 209	932 = 210	1729 = 211	794 = 212	3398 = 213	2655 = 214	4393 = 215	1146 = 216	1010 = 217	1270 = 218	2244 = 219	3869 = 220	3427 + e.k3485 + (e.k2819
3339 = 221	257 = 222	3538 = 223	3092 = 224	1640 = 225	4050 = 226	4043 = 227	3577 = 228	3178 = 229	4190 = 230	3946 = 231	862 = 232	4501 = 233	1948 + e.k3390 + (e.k1557
1364 = 234	4799 = 235	2654 = 236	1655 = 237	120 = 238	2836 = 239	1342 = 240	2865 = 241	3088 = 242	4844 = 243	4259 = 244	3183 = 245	3709 = 246	4228 + e.k444 + (e.k3020
4704 = 247	4823 = 248	3786 = 249	2934 = 250	4782 = 251	1211 = 252	3936 = 253	3246 = 254	2687 = 255	740 = 256	4010 = 257	1913 = 258	2140 = 259	2050 + e.k45 + (e.k892`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e7 = fill7(born());
function fill8(e) {`,
      [
        `2382 = 0	4982 = 1	2168 = 2	904 = 3	2041 = 4	2932 = 5	166 = 6	1413 = 7	4400 = 8	2077 = 9	2400 = 10	2346 = 11	2071 = 12	2932 + e.k2400 + (e.k4656
4594 = 13	1077 = 14	2151 = 15	3972 = 16	620 = 17	2233 = 18	237 = 19	2335 = 20	2273 = 21	4171 = 22	1246 = 23	3192 = 24	1311 = 25	904 + e.k2077 + (e.k3961
4459 = 26	1072 = 27	4992 = 28	731 = 29	4454 = 30	1333 = 31	4379 = 32	4827 = 33	2128 = 34	2510 = 35	445 = 36	3498 = 37	2971 = 38	2971 + e.k731 + (e.k2869
4444 = 39	1912 = 40	3940 = 41	3709 = 42	3034 = 43	2831 = 44	1770 = 45	4142 = 46	2217 = 47	4636 = 48	2857 = 49	1902 = 50	617 = 51	2971 + e.k1333 + (e.k3809
4504 = 52	903 = 53	4709 = 54	588 = 55	2476 = 56	21 = 57	835 = 58	4632 = 59	980 = 60	1599 = 61	3009 = 62	2533 = 63	2896 = 64	2041 + e.k3192 + (e.k1207
1153 = 65	503 = 66	556 = 67	1152 = 68	243 = 69	3385 = 70	4677 = 71	1171 = 72	4269 = 73	4442 = 74	632 = 75	3578 = 76	4317 = 77	980 + e.k904 + (e.k3595
1512 = 78	705 = 79	4314 = 80	2901 = 81	4087 = 82	1618 = 83	833 = 84	3418 = 85	1142 = 86	3980 = 87	1580 = 88	644 = 89	3989 = 90	4442 + e.k617 + (e.k4451
242 = 91	4567 = 92	4599 = 93	729 = 94	1105 = 95	2459 = 96	2097 = 97	2749 = 98	1797 = 99	2232 = 100	1238 = 101	4433 = 102	1267 = 103	166 + e.k445 + (e.k1333
3503 = 104	165 = 105	4988 = 106	4011 = 107	4838 = 108	4681 = 109	2590 = 110	1388 = 111	707 = 112	4253 = 113	1287 = 114	260 = 115	894 = 116	2932 + e.k4171 + (e.k3286
915 = 117	2440 = 118	2464 = 119	197 = 120	3393 = 121	261 = 122	1221 = 123	1526 = 124	4953 = 125	4257 = 126	4751 = 127	680 = 128	5 = 129	4709 + e.k2932 + (e.k198
3041 = 130	3239 = 131	1900 = 132	3339 = 133	2871 = 134	2748 = 135	1796 = 136	2840 = 137	3211 = 138	122 = 139	1981 = 140	2148 = 141	391 = 142	2476 + e.k4838 + (e.k4089
4797 = 143	3028 = 144	4309 = 145	2747 = 146	2882 = 147	3726 = 148	1920 = 149	1439 = 150	1645 = 151	1228 = 152	1732 = 153	2076 = 154	3697 = 155	3972 + e.k2464 + (e.k201
3923 = 156	1809 = 157	2726 = 158	1514 = 159	1951 = 160	4999 = 161	2131 = 162	4878 = 163	4282 = 164	4704 = 165	2088 = 166	4697 = 167	183 = 168	4142 + e.k3980 + (e.k124
1511 = 169	2546 = 170	538 = 171	2469 = 172	4175 = 173	2699 = 174	1674 = 175	282 = 176	2030 = 177	4424 = 178	758 = 179	643 = 180	4125 = 181	3709 + e.k4317 + (e.k340
2002 = 182	3617 = 183	1784 = 184	367 = 185	3394 = 186	4563 = 187	1130 = 188	3037 = 189	2920 = 190	572 = 191	599 = 192	3171 = 193	1110 = 194	1142 + e.k503 + (e.k4603
3433 = 195	1904 = 196	2770 = 197	1695 = 198	3108 = 199	2351 = 200	4605 = 201	4860 = 202	558 = 203	3898 = 204	113 = 205	426 = 206	269 = 207	729 + e.k282 + (e.k3874
3116 = 208	533 = 209	3480 = 210	1298 = 211	1175 = 212	554 = 213	1684 = 214	1309 = 215	4037 = 216	1852 = 217	2608 = 218	2800 = 219	1135 = 220	2896 + e.k1514 + (e.k2597
1116 = 221	1161 = 222	2617 = 223	350 = 224	1578 = 225	1943 = 226	1111 = 227	1941 = 228	3717 = 229	3049 = 230	984 = 231	2236 = 232	1199 = 233	3709 + e.k242 + (e.k1176
586 = 234	2846 = 235	403 = 236	1008 = 237	2514 = 238	2631 = 239	1497 = 240	4771 = 241	1005 = 242	2243 = 243	4316 = 244	4276 = 245	4426 = 246	1943 + e.k3726 + (e.k4759
4650 = 247	3624 = 248	4315 = 249	2144 = 250	754 = 251	667 = 252	1826 = 253	135 = 254	628 = 255	2534 = 256	4127 = 257	1523 = 258	1313 = 259	554 + e.k2800 + (e.k4424`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e8 = fill8(born());
function fill9(e) {`,
      [
        `4807 = 0	3771 = 1	2100 = 2	2723 = 3	4026 = 4	1911 = 5	1332 = 6	3836 = 7	4168 = 8	4599 = 9	2364 = 10	1400 = 11	2568 = 12	1332 + e.k4026 + (e.k729
1926 = 13	4546 = 14	4781 = 15	3306 = 16	1291 = 17	2783 = 18	2326 = 19	794 = 20	26 = 21	2843 = 22	3927 = 23	4582 = 24	918 = 25	4546 + e.k3927 + (e.k3879
4073 = 26	4212 = 27	3104 = 28	13 = 29	4067 = 30	3284 = 31	2204 = 32	4077 = 33	4703 = 34	4658 = 35	3786 = 36	461 = 37	736 = 38	4658 + e.k13 + (e.k3080
2617 = 39	4075 = 40	3946 = 41	505 = 42	1171 = 43	222 = 44	2294 = 45	4411 = 46	3626 = 47	411 = 48	693 = 49	2295 = 50	414 = 51	1171 + e.k2204 + (e.k3288
1920 = 52	4777 = 53	3265 = 54	341 = 55	2086 = 56	1596 = 57	4128 = 58	838 = 59	3491 = 60	2892 = 61	4547 = 62	476 = 63	593 = 64	4599 + e.k13 + (e.k2426
4013 = 65	3950 = 66	1240 = 67	2380 = 68	2588 = 69	4120 = 70	2805 = 71	1609 = 72	1762 = 73	3654 = 74	2447 = 75	1048 = 76	2021 = 77	13 + e.k2021 + (e.k4898
2240 = 78	2438 = 79	1443 = 80	963 = 81	3896 = 82	2484 = 83	1999 = 84	362 = 85	187 = 86	4192 = 87	2811 = 88	3857 = 89	3275 = 90	2484 + e.k362 + (e.k3725
528 = 91	1308 = 92	896 = 93	2127 = 94	2359 = 95	3194 = 96	2544 = 97	2082 = 98	1523 = 99	2141 = 100	1026 = 101	479 = 102	3573 = 103	341 + e.k4212 + (e.k2444
3338 = 104	3231 = 105	20 = 106	4662 = 107	2166 = 108	4044 = 109	4029 = 110	1842 = 111	3149 = 112	2894 = 113	320 = 114	1319 = 115	4095 = 116	3104 + e.k1048 + (e.k697
1873 = 117	1891 = 118	964 = 119	1255 = 120	4225 = 121	3533 = 122	3823 = 123	2235 = 124	1534 = 125	220 = 126	2186 = 127	845 = 128	2708 = 129	4192 + e.k2141 + (e.k137
2690 = 130	444 = 131	218 = 132	4365 = 133	4756 = 134	2481 = 135	3802 = 136	464 = 137	2730 = 138	893 = 139	2288 = 140	1781 = 141	4280 = 142	20 + e.k2811 + (e.k3495
3996 = 143	539 = 144	289 = 145	791 = 146	4386 = 147	3875 = 148	4310 = 149	2046 = 150	2361 = 151	1632 = 152	4757 = 153	2983 = 154	1976 = 155	3950 + e.k3927 + (e.k3111
3555 = 156	2682 = 157	3262 = 158	573 = 159	427 = 160	2910 = 161	2421 = 162	4316 = 163	4354 = 164	3394 = 165	1765 = 166	3332 = 167	1928 = 168	2086 + e.k1026 + (e.k2454
3882 = 169	647 = 170	999 = 171	3517 = 172	3547 = 173	3899 = 174	3407 = 175	4096 = 176	2057 = 177	4802 = 178	4433 = 179	3437 = 180	100 = 181	2295 + e.k1842 + (e.k489
4323 = 182	715 = 183	1551 = 184	1489 = 185	466 = 186	1231 = 187	1504 = 188	4516 = 189	2232 = 190	4789 = 191	2615 = 192	2196 = 193	339 = 194	2186 + e.k4310 + (e.k422
474 = 195	3740 = 196	497 = 197	3542 = 198	873 = 199	3889 = 200	1587 = 201	2069 = 202	459 = 203	4508 = 204	581 = 205	17 = 206	2207 = 207	341 + e.k1765 + (e.k3205
3807 = 208	3584 = 209	1047 = 210	3486 = 211	4081 = 212	4695 = 213	2005 = 214	3301 = 215	1965 = 216	3349 = 217	380 = 218	712 = 219	4620 = 220	1291 + e.k2361 + (e.k2782
1053 = 221	2008 = 222	448 = 223	4672 = 224	3880 = 225	3298 = 226	137 = 227	3138 = 228	596 = 229	3203 = 230	3838 = 231	865 = 232	1703 = 233	4789 + e.k896 + (e.k4742
3986 = 234	4815 = 235	2585 = 236	982 = 237	2749 = 238	2491 = 239	180 = 240	1809 = 241	4726 = 242	3362 = 243	3267 = 244	1569 = 245	2108 = 246	3533 + e.k593 + (e.k2098
277 = 247	757 = 248	2193 = 249	3673 = 250	1696 = 251	2996 = 252	3578 = 253	1676 = 254	3711 = 255	3564 = 256	2584 = 257	1730 = 258	191 = 259	3807 + e.k1443 + (e.k206`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e9 = fill9(born());
function fill10(e) {`,
      [
        `1118 = 0	4789 = 1	2660 = 2	4169 = 3	176 = 4	2248 = 5	4646 = 6	2811 = 7	4327 = 8	4056 = 9	2679 = 10	1368 = 11	4050 = 12	1368 + e.k2660 + (e.k2617
3992 = 13	2368 = 14	3440 = 15	1189 = 16	803 = 17	4963 = 18	394 = 19	3771 = 20	3791 = 21	4340 = 22	4564 = 23	3601 = 24	4664 = 25	3771 + e.k4169 + (e.k54
184 = 26	2377 = 27	2888 = 28	3543 = 29	424 = 30	617 = 31	74 = 32	2460 = 33	4472 = 34	1377 = 35	2977 = 36	1769 = 37	3114 = 38	2660 + e.k2977 + (e.k2490
2241 = 39	1199 = 40	2936 = 41	4737 = 42	4401 = 43	4207 = 44	197 = 45	4419 = 46	3068 = 47	3258 = 48	3314 = 49	1217 = 50	2548 = 51	3601 + e.k4737 + (e.k2066
2045 = 52	1692 = 53	1457 = 54	208 = 55	964 = 56	702 = 57	218 = 58	1567 = 59	2165 = 60	171 = 61	4006 = 62	471 = 63	4771 = 64	3314 + e.k4564 + (e.k3402
230 = 65	2385 = 66	2708 = 67	1730 = 68	2968 = 69	2634 = 70	2761 = 71	1789 = 72	3882 = 73	2569 = 74	226 = 75	3619 = 76	4669 = 77	471 + e.k176 + (e.k1965
2305 = 78	4991 = 79	4139 = 80	2942 = 81	1830 = 82	4495 = 83	1824 = 84	4931 = 85	2617 = 86	1230 = 87	2795 = 88	3604 = 89	3532 = 90	226 + e.k1377 + (e.k2215
1438 = 91	1493 = 92	4855 = 93	1404 = 94	3875 = 95	2909 = 96	4952 = 97	2852 = 98	1770 = 99	2609 = 100	1855 = 101	3924 = 102	2984 = 103	4664 + e.k2617 + (e.k679
484 = 104	1873 = 105	4038 = 106	385 = 107	513 = 108	4450 = 109	4777 = 110	200 = 111	780 = 112	2654 = 113	362 = 114	4861 = 115	2892 = 116	4327 + e.k74 + (e.k1527
4029 = 117	4916 = 118	4368 = 119	3166 = 120	834 = 121	3421 = 122	1445 = 123	4536 = 124	2233 = 125	358 = 126	1250 = 127	2641 = 128	440 = 129	2165 + e.k4952 + (e.k2374
3829 = 130	2367 = 131	1810 = 132	4598 = 133	168 = 134	2915 = 135	2949 = 136	28 = 137	2038 = 138	2393 = 139	2455 = 140	2137 = 141	122 = 142	424 + e.k2852 + (e.k2620
132 = 143	2983 = 144	2542 = 145	3411 = 146	4849 = 147	1412 = 148	2200 = 149	1417 = 150	925 = 151	1331 = 152	788 = 153	3842 = 154	4192 = 155	358 + e.k4789 + (e.k482
1555 = 156	2554 = 157	4464 = 158	3639 = 159	4099 = 160	2000 = 161	3384 = 162	3194 = 163	2967 = 164	4129 = 165	2175 = 166	3838 = 167	3637 = 168	1873 + e.k2233 + (e.k4818
4332 = 169	4712 = 170	4366 = 171	1834 = 172	2334 = 173	181 = 174	2426 = 175	2466 = 176	3208 = 177	260 = 178	321 = 179	3737 = 180	2339 = 181	2852 + e.k617 + (e.k4349
4274 = 182	1566 = 183	3010 = 184	4562 = 185	3041 = 186	3724 = 187	741 = 188	3255 = 189	4105 = 190	4529 = 191	1856 = 192	4753 = 193	1594 = 194	4771 + e.k4050 + (e.k957
609 = 195	897 = 196	2022 = 197	4377 = 198	2751 = 199	4452 = 200	3494 = 201	4217 = 202	4555 = 203	2538 = 204	318 = 205	2370 = 206	4233 = 207	2811 + e.k1493 + (e.k4989
2922 = 208	618 = 209	4356 = 210	922 = 211	109 = 212	1214 = 213	3190 = 214	906 = 215	3667 = 216	4607 = 217	3567 = 218	4845 = 219	4478 = 220	3875 + e.k122 + (e.k2703
4848 = 221	458 = 222	4770 = 223	1418 = 224	562 = 225	3800 = 226	1984 = 227	4091 = 228	1775 = 229	3661 = 230	2758 = 231	4733 = 232	146 = 233	1770 + e.k1769 + (e.k4853
100 = 234	1802 = 235	1755 = 236	4947 = 237	596 = 238	1988 = 239	2735 = 240	1452 = 241	4577 = 242	4285 = 243	829 = 244	1507 = 245	2148 = 246	2967 + e.k100 + (e.k4979
1542 = 247	1833 = 248	1355 = 249	468 = 250	2816 = 251	280 = 252	1151 = 253	1652 = 254	245 = 255	1339 = 256	3879 = 257	2632 = 258	2124 = 259	1493 + e.k484 + (e.k4097`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e10 = fill10(born());
function fill11(e) {`,
      [
        `93 = 0	4093 = 1	4629 = 2	1956 = 3	3673 = 4	1553 = 5	3968 = 6	351 = 7	639 = 8	4445 = 9	274 = 10	1065 = 11	1552 = 12	1553 + e.k3968 + (e.k1746
3141 = 13	3832 = 14	1846 = 15	3570 = 16	3077 = 17	1336 = 18	2981 = 19	422 = 20	2873 = 21	549 = 22	1210 = 23	2267 = 24	1329 = 25	1210 + e.k93 + (e.k26
307 = 26	232 = 27	1978 = 28	3120 = 29	1187 = 30	708 = 31	382 = 32	1136 = 33	2803 = 34	4928 = 35	306 = 36	4854 = 37	922 = 38	274 + e.k1187 + (e.k1165
1883 = 39	2348 = 40	1474 = 41	1564 = 42	3688 = 43	918 = 44	3579 = 45	1642 = 46	603 = 47	4279 = 48	1377 = 49	578 = 50	1381 = 51	639 + e.k274 + (e.k1114
4387 = 52	3076 = 53	3356 = 54	1225 = 55	3097 = 56	4654 = 57	4161 = 58	789 = 59	3178 = 60	45 = 61	3885 = 62	2518 = 63	325 = 64	3832 + e.k639 + (e.k4640
230 = 65	1584 = 66	2750 = 67	76 = 68	3463 = 69	4813 = 70	3212 = 71	2373 = 72	4438 = 73	2342 = 74	1081 = 75	1314 = 76	3048 = 77	2981 + e.k232 + (e.k2726
882 = 78	334 = 79	2161 = 80	2330 = 81	2432 = 82	2398 = 83	2002 = 84	812 = 85	1521 = 86	3222 = 87	2799 = 88	2062 = 89	923 = 90	4654 + e.k1210 + (e.k4956
4567 = 91	988 = 92	3400 = 93	2966 = 94	4838 = 95	4959 = 96	4726 = 97	4727 = 98	2272 = 99	1918 = 100	3959 = 101	2208 = 102	4685 = 103	3968 + e.k306 + (e.k398
1177 = 104	2126 = 105	3307 = 106	4068 = 107	4620 = 108	736 = 109	1078 = 110	509 = 111	3557 = 112	4741 = 113	2291 = 114	1708 = 115	2644 = 116	1564 + e.k923 + (e.k1178
4971 = 117	3189 = 118	1568 = 119	2194 = 120	3666 = 121	247 = 122	2150 = 123	1532 = 124	2995 = 125	4146 = 126	4961 = 127	1554 = 128	4442 = 129	4620 + e.k2981 + (e.k894
2152 = 130	1627 = 131	3115 = 132	4560 = 133	4978 = 134	2780 = 135	8 = 136	943 = 137	16 = 138	2688 = 139	2254 = 140	3842 = 141	4153 = 142	3842 + e.k4445 + (e.k2722
221 = 143	534 = 144	3532 = 145	1904 = 146	3944 = 147	1457 = 148	3792 = 149	3884 = 150	3448 = 151	2196 = 152	2602 = 153	4602 = 154	3256 = 155	2194 + e.k2208 + (e.k1691
1977 = 156	2561 = 157	4410 = 158	1244 = 159	1663 = 160	1029 = 161	4906 = 162	1327 = 163	289 = 164	3455 = 165	3391 = 166	1501 = 167	4468 = 168	1065 + e.k4602 + (e.k1462
1595 = 169	4688 = 170	2938 = 171	477 = 172	3024 = 173	805 = 174	292 = 175	1139 = 176	3763 = 177	2098 = 178	2094 = 179	4487 = 180	3732 = 181	2194 + e.k4146 + (e.k2466
925 = 182	469 = 183	209 = 184	3899 = 185	1878 = 186	826 = 187	244 = 188	4802 = 189	1323 = 190	523 = 191	1312 = 192	4354 = 193	2852 = 194	882 + e.k3307 + (e.k1707
1049 = 195	763 = 196	4943 = 197	2821 = 198	985 = 199	3054 = 200	3042 = 201	3490 = 202	4539 = 203	4768 = 204	1972 = 205	440 = 206	4420 = 207	2821 + e.k289 + (e.k602
2676 = 208	2351 = 209	3637 = 210	2343 = 211	3474 = 212	3837 = 213	1731 = 214	88 = 215	3615 = 216	3902 = 217	2157 = 218	3949 = 219	4927 = 220	4068 + e.k2348 + (e.k3750
4173 = 221	1284 = 222	4181 = 223	2180 = 224	481 = 225	4415 = 226	1077 = 227	2944 = 228	4972 = 229	2993 = 230	793 = 231	2376 = 232	604 = 233	4410 + e.k1642 + (e.k2624
4984 = 234	4142 = 235	3440 = 236	2289 = 237	3231 = 238	3964 = 239	3260 = 240	3930 = 241	2927 = 242	661 = 243	964 = 244	379 = 245	3273 = 246	1846 + e.k3899 + (e.k3413
4369 = 247	650 = 248	1234 = 249	1221 = 250	4660 = 251	3468 = 252	803 = 253	4932 = 254	1886 = 255	1213 = 256	3641 = 257	2417 = 258	2546 = 259	422 + e.k2417 + (e.k1954`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e11 = fill11(born());
function fill12(e) {`,
      [
        `1146 = 0	4475 = 1	4218 = 2	4477 = 3	2322 = 4	2038 = 5	1403 = 6	4521 = 7	4235 = 8	2600 = 9	1379 = 10	4874 = 11	2150 = 12	4874 + e.k2150 + (e.k683
1986 = 13	2758 = 14	3442 = 15	1834 = 16	3797 = 17	512 = 18	968 = 19	4172 = 20	783 = 21	1893 = 22	1389 = 23	1994 = 24	3449 = 25	1403 + e.k1403 + (e.k3099
4065 = 26	3980 = 27	2986 = 28	1625 = 29	3022 = 30	631 = 31	1442 = 32	1845 = 33	4968 = 34	4960 = 35	2030 = 36	1053 = 37	736 = 38	4172 + e.k3022 + (e.k742
4141 = 39	4898 = 40	4250 = 41	4983 = 42	3541 = 43	3331 = 44	1936 = 45	3066 = 46	3363 = 47	2999 = 48	1010 = 49	2050 = 50	2887 = 51	3363 + e.k968 + (e.k360
3814 = 52	2883 = 53	4595 = 54	2198 = 55	1260 = 56	2355 = 57	3162 = 58	365 = 59	2058 = 60	3149 = 61	2583 = 62	4659 = 63	824 = 64	2355 + e.k2583 + (e.k2908
1423 = 65	2479 = 66	4846 = 67	3099 = 68	958 = 69	1164 = 70	4349 = 71	687 = 72	4375 = 73	2085 = 74	4011 = 75	1850 = 76	773 = 77	4874 + e.k2058 + (e.k821
551 = 78	2890 = 79	3878 = 80	1651 = 81	2381 = 82	3477 = 83	2279 = 84	2502 = 85	3929 = 86	247 = 87	1715 = 88	4666 = 89	2671 = 90	1845 + e.k4235 + (e.k2440
4067 = 91	1568 = 92	97 = 93	982 = 94	3435 = 95	634 = 96	677 = 97	4940 = 98	4538 = 99	123 = 100	1983 = 101	3713 = 102	3828 = 103	1850 + e.k3541 + (e.k4348
4904 = 104	3996 = 105	2616 = 106	2610 = 107	285 = 108	4228 = 109	3448 = 110	3590 = 111	2896 = 112	2112 = 113	1091 = 114	2946 = 115	4705 = 116	2150 + e.k783 + (e.k2695
1011 = 117	1031 = 118	2799 = 119	738 = 120	1443 = 121	4564 = 122	796 = 123	4127 = 124	758 = 125	1464 = 126	1280 = 127	2450 = 128	2596 = 129	2887 + e.k2355 + (e.k993
4734 = 130	2424 = 131	2413 = 132	641 = 133	3715 = 134	293 = 135	3874 = 136	1087 = 137	2561 = 138	979 = 139	1294 = 140	4252 = 141	4342 = 142	1011 + e.k773 + (e.k3621
3387 = 143	4222 = 144	4980 = 145	4667 = 146	3644 = 147	756 = 148	1188 = 149	386 = 150	1314 = 151	2535 = 152	932 = 153	3596 = 154	1147 = 155	968 + e.k386 + (e.k2613
3812 = 156	1383 = 157	4623 = 158	4703 = 159	2289 = 160	4995 = 161	2717 = 162	848 = 163	2738 = 164	3430 = 165	9 = 166	4033 = 167	4486 = 168	3814 + e.k1893 + (e.k3404
3098 = 169	762 = 170	1733 = 171	568 = 172	2850 = 173	2189 = 174	4840 = 175	1489 = 176	3383 = 177	2690 = 178	4264 = 179	1665 = 180	3506 = 181	4734 + e.k4235 + (e.k414
3787 = 182	341 = 183	2107 = 184	487 = 185	3815 = 186	874 = 187	4487 = 188	1126 = 189	4885 = 190	1618 = 191	4644 = 192	4365 = 193	4417 = 194	4011 + e.k4375 + (e.k2395
4765 = 195	24 = 196	1750 = 197	3111 = 198	1301 = 199	3900 = 200	3605 = 201	1459 = 202	4051 = 203	4798 = 204	1709 = 205	986 = 206	2994 = 207	986 + e.k2610 + (e.k3265
1347 = 208	3502 = 209	1894 = 210	744 = 211	42 = 212	3881 = 213	1044 = 214	2888 = 215	743 = 216	1975 = 217	2332 = 218	4404 = 219	3580 = 220	968 + e.k2535 + (e.k3404
3742 = 221	223 = 222	3832 = 223	3032 = 224	3728 = 225	4142 = 226	2673 = 227	4643 = 228	1262 = 229	370 = 230	4307 = 231	3170 = 232	4608 = 233	512 + e.k3996 + (e.k2011
2943 = 234	266 = 235	4505 = 236	651 = 237	3487 = 238	1838 = 239	2873 = 240	669 = 241	2594 = 242	1833 = 243	3020 = 244	934 = 245	2548 = 246	3828 + e.k874 + (e.k4897
1122 = 247	482 = 248	4836 = 249	3126 = 250	2756 = 251	1444 = 252	1509 = 253	862 = 254	2795 = 255	124 = 256	3637 = 257	1890 = 258	1526 = 259	2189 + e.k3032 + (e.k1863`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e12 = fill12(born());
function fill13(e) {`,
      [
        `4095 = 0	516 = 1	416 = 2	2517 = 3	3377 = 4	2215 = 5	4475 = 6	2391 = 7	3275 = 8	4628 = 9	4411 = 10	2383 = 11	3023 = 12	2383 + e.k3377 + (e.k2776
137 = 13	3736 = 14	371 = 15	2750 = 16	4764 = 17	4025 = 18	3094 = 19	759 = 20	2211 = 21	424 = 22	61 = 23	2429 = 24	2441 = 25	371 + e.k2750 + (e.k2179
1287 = 26	941 = 27	1946 = 28	241 = 29	3937 = 30	4874 = 31	160 = 32	233 = 33	2951 = 34	3635 = 35	4390 = 36	4306 = 37	1331 = 38	2951 + e.k424 + (e.k535
197 = 39	3433 = 40	831 = 41	3291 = 42	4558 = 43	4040 = 44	795 = 45	2816 = 46	3163 = 47	2208 = 48	4121 = 49	3198 = 50	1160 = 51	1287 + e.k424 + (e.k2331
2463 = 52	3781 = 53	4369 = 54	4743 = 55	4302 = 56	4225 = 57	426 = 58	4399 = 59	4901 = 60	4576 = 61	406 = 62	4909 = 63	3891 = 64	4764 + e.k197 + (e.k3092
1086 = 65	3075 = 66	59 = 67	4758 = 68	1348 = 69	4612 = 70	1182 = 71	4006 = 72	921 = 73	2515 = 74	3534 = 75	57 = 76	2688 = 77	2391 + e.k4040 + (e.k1068
1840 = 78	3101 = 79	2253 = 80	663 = 81	3353 = 82	496 = 83	4821 = 84	4324 = 85	630 = 86	274 = 87	3621 = 88	3928 = 89	2037 = 90	4874 + e.k3023 + (e.k4380
2770 = 91	1398 = 92	854 = 93	4749 = 94	3125 = 95	3788 = 96	1016 = 97	3650 = 98	1029 = 99	2239 = 100	4527 = 101	4106 = 102	899 = 103	1029 + e.k1840 + (e.k1292
1491 = 104	2732 = 105	3149 = 106	3361 = 107	4219 = 108	3873 = 109	4298 = 110	3565 = 111	1090 = 112	4882 = 113	2551 = 114	155 = 115	4341 = 116	2732 + e.k4006 + (e.k889
1870 = 117	2002 = 118	1622 = 119	3766 = 120	3950 = 121	4966 = 122	2863 = 123	2412 = 124	2558 = 125	158 = 126	1060 = 127	743 = 128	1715 = 129	1090 + e.k2002 + (e.k1101
341 = 130	1941 = 131	816 = 132	1985 = 133	969 = 134	664 = 135	2157 = 136	4489 = 137	838 = 138	3641 = 139	2277 = 140	4755 = 141	3871 = 142	3650 + e.k2253 + (e.k4181
1048 = 143	2877 = 144	4172 = 145	2222 = 146	4301 = 147	4936 = 148	2656 = 149	1116 = 150	1202 = 151	2108 = 152	1731 = 153	1424 = 154	1853 = 155	4758 + e.k371 + (e.k3606
948 = 156	305 = 157	3358 = 158	2738 = 159	4642 = 160	608 = 161	482 = 162	356 = 163	3221 = 164	502 = 165	4193 = 166	3997 = 167	388 = 168	3650 + e.k4764 + (e.k186
4791 = 169	3661 = 170	1633 = 171	2597 = 172	3564 = 173	3011 = 174	483 = 175	555 = 176	3102 = 177	3318 = 178	3786 = 179	1680 = 180	1228 = 181	3075 + e.k2429 + (e.k1786
3696 = 182	3622 = 183	4490 = 184	890 = 185	1280 = 186	30 = 187	3258 = 188	2005 = 189	1857 = 190	1123 = 191	1814 = 192	3405 = 193	4840 = 194	4558 + e.k2688 + (e.k3718
1097 = 195	169 = 196	4988 = 197	1421 = 198	2512 = 199	1434 = 200	2902 = 201	681 = 202	2779 = 203	584 = 204	2857 = 205	442 = 206	4501 = 207	1853 + e.k3873 + (e.k2619
430 = 208	3824 = 209	3972 = 210	603 = 211	3765 = 212	119 = 213	4925 = 214	4930 = 215	1392 = 216	2997 = 217	2976 = 218	510 = 219	38 = 220	1392 + e.k3661 + (e.k4604
2651 = 221	4026 = 222	3971 = 223	4861 = 224	1621 = 225	282 = 226	4915 = 227	1717 = 228	3787 = 229	3250 = 230	92 = 231	4539 = 232	2669 = 233	3781 + e.k4915 + (e.k2073
4668 = 234	3234 = 235	2591 = 236	2250 = 237	529 = 238	796 = 239	4716 = 240	2502 = 241	3235 = 242	1018 = 243	751 = 244	4898 = 245	4176 = 246	3250 + e.k3972 + (e.k2929
3464 = 247	2923 = 248	374 = 249	2780 = 250	1602 = 251	4722 = 252	4348 = 253	2464 = 254	2657 = 255	116 = 256	4288 = 257	2470 = 258	3412 = 259	795 + e.k1331 + (e.k3950`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e13 = fill13(born());
function fill14(e) {`,
      [
        `812 = 0	4198 = 1	1039 = 2	1832 = 3	4318 = 4	4790 = 5	9 = 6	1075 = 7	497 = 8	4065 = 9	3656 = 10	4057 = 11	228 = 12	1832 + e.k812 + (e.k3375
3675 = 13	2201 = 14	320 = 15	4309 = 16	34 = 17	3829 = 18	954 = 19	2688 = 20	1444 = 21	3395 = 22	2697 = 23	4741 = 24	1032 = 25	812 + e.k1039 + (e.k3281
3387 = 26	4222 = 27	4307 = 28	2258 = 29	2352 = 30	2402 = 31	2863 = 32	701 = 33	3241 = 34	3005 = 35	1678 = 36	1558 = 37	11 = 38	4065 + e.k812 + (e.k2875
821 = 39	746 = 40	4825 = 41	3994 = 42	511 = 43	3870 = 44	1337 = 45	403 = 46	2736 = 47	3192 = 48	2425 = 49	2225 = 50	1911 = 51	1678 + e.k1444 + (e.k2019
692 = 52	1811 = 53	148 = 54	1205 = 55	234 = 56	1309 = 57	4044 = 58	4758 = 59	3440 = 60	3390 = 61	3014 = 62	4489 = 63	2570 = 64	2697 + e.k1032 + (e.k4330
2510 = 65	1544 = 66	4361 = 67	3526 = 68	842 = 69	3795 = 70	242 = 71	2912 = 72	4991 = 73	4216 = 74	412 = 75	1997 = 76	1030 = 77	3005 + e.k1030 + (e.k4601
1904 = 78	2640 = 79	1661 = 80	2003 = 81	2420 = 82	1278 = 83	4122 = 84	4066 = 85	875 = 86	1771 = 87	4432 = 88	4036 = 89	420 = 90	1558 + e.k701 + (e.k1616
3021 = 91	1770 = 92	548 = 93	1397 = 94	2419 = 95	346 = 96	20 = 97	2896 = 98	673 = 99	2917 = 100	379 = 101	1668 = 102	3550 = 103	701 + e.k2419 + (e.k1732
1956 = 104	1846 = 105	790 = 106	2943 = 107	4377 = 108	2444 = 109	459 = 110	1025 = 111	3617 = 112	813 = 113	2150 = 114	3606 = 115	1022 = 116	2150 + e.k3795 + (e.k2832
1999 = 117	4720 = 118	3221 = 119	2173 = 120	29 = 121	4460 = 122	4538 = 123	3077 = 124	4395 = 125	1974 = 126	3677 = 127	1163 = 128	3978 = 129	511 + e.k9 + (e.k2107
1831 = 130	1630 = 131	3946 = 132	2305 = 133	1830 = 134	4532 = 135	734 = 136	4172 = 137	2817 = 138	3413 = 139	409 = 140	4332 = 141	988 = 142	4065 + e.k2640 + (e.k928
421 = 143	3790 = 144	1935 = 145	1393 = 146	513 = 147	3692 = 148	4597 = 149	1708 = 150	1984 = 151	1035 = 152	3857 = 153	684 = 154	2837 = 155	3656 + e.k4597 + (e.k2029
4965 = 156	3902 = 157	3410 = 158	938 = 159	117 = 160	1121 = 161	2321 = 162	1094 = 163	197 = 164	4864 = 165	2094 = 166	4893 = 167	1123 = 168	3390 + e.k34 + (e.k819
4794 = 169	2490 = 170	3698 = 171	1178 = 172	3275 = 173	4023 = 174	4272 = 175	232 = 176	1307 = 177	4000 = 178	1532 = 179	4037 = 180	1769 = 181	3192 + e.k1178 + (e.k1163
2597 = 182	2829 = 183	1650 = 184	461 = 185	3646 = 186	3757 = 187	3878 = 188	3598 = 189	1110 = 190	2371 = 191	2242 = 192	3531 = 193	2399 = 194	3531 + e.k3221 + (e.k2236
1576 = 195	2478 = 196	4519 = 197	520 = 198	4670 = 199	4143 = 200	1194 = 201	4547 = 202	4662 = 203	4383 = 204	536 = 205	3001 = 206	3781 = 207	3192 + e.k548 + (e.k8
656 = 208	3419 = 209	3931 = 210	1707 = 211	697 = 212	3099 = 213	3746 = 214	4134 = 215	3613 = 216	450 = 217	1001 = 218	4667 = 219	3341 = 220	697 + e.k117 + (e.k1416
1189 = 221	3756 = 222	515 = 223	1124 = 224	982 = 225	4167 = 226	649 = 227	3481 = 228	888 = 229	864 = 230	632 = 231	4996 = 232	601 = 233	684 + e.k3692 + (e.k1990
3647 = 234	4534 = 235	2263 = 236	4791 = 237	4677 = 238	4464 = 239	393 = 240	184 = 241	1636 = 242	2844 = 243	3534 = 244	785 = 245	1112 = 246	938 + e.k4758 + (e.k4769
4842 = 247	544 = 248	2125 = 249	1299 = 250	381 = 251	1781 = 252	4577 = 253	2823 = 254	3351 = 255	4195 = 256	1692 = 257	3845 = 258	1677 = 259	4864 + e.k1911 + (e.k3106`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e14 = fill14(born());
function fill15(e) {`,
      [
        `4948 = 0	4667 = 1	2325 = 2	2024 = 3	3215 = 4	1361 = 5	1843 = 6	227 = 7	1989 = 8	3005 = 9	961 = 10	3556 = 11	1113 = 12	4948 + e.k2024 + (e.k2157
4481 = 13	2417 = 14	4242 = 15	4962 = 16	4530 = 17	288 = 18	1407 = 19	4568 = 20	4527 = 21	4883 = 22	1933 = 23	2399 = 24	1011 = 25	1011 + e.k2399 + (e.k4824
4714 = 26	3601 = 27	2557 = 28	871 = 29	2401 = 30	173 = 31	4708 = 32	3247 = 33	4246 = 34	3719 = 35	3860 = 36	1460 = 37	698 = 38	2557 + e.k4568 + (e.k1206
1867 = 39	2282 = 40	1663 = 41	61 = 42	1584 = 43	653 = 44	1467 = 45	4288 = 46	1408 = 47	4793 = 48	4916 = 49	3935 = 50	3859 = 51	871 + e.k1584 + (e.k4542
1153 = 52	2421 = 53	4150 = 54	3800 = 55	4300 = 56	4310 = 57	1764 = 58	2262 = 59	822 = 60	4796 = 61	2453 = 62	2205 = 63	4496 = 64	871 + e.k4300 + (e.k4408
1708 = 65	2362 = 66	2525 = 67	3051 = 68	3542 = 69	4037 = 70	4498 = 71	1517 = 72	2916 = 73	1199 = 74	4128 = 75	4058 = 76	4248 = 77	1011 + e.k3800 + (e.k4333
2773 = 78	1284 = 79	3150 = 80	3593 = 81	712 = 82	978 = 83	142 = 84	2596 = 85	4843 = 86	1882 = 87	3573 = 88	3983 = 89	4947 = 90	173 + e.k2325 + (e.k849
4492 = 91	2962 = 92	4587 = 93	2201 = 94	741 = 95	4491 = 96	409 = 97	3505 = 98	3932 = 99	3940 = 100	1362 = 101	3208 = 102	4189 = 103	4962 + e.k961 + (e.k4157
2933 = 104	2442 = 105	1355 = 106	223 = 107	1259 = 108	1451 = 109	1490 = 110	1393 = 111	4640 = 112	4235 = 113	1817 = 114	2393 = 115	727 = 116	2557 + e.k1933 + (e.k4598
3703 = 117	48 = 118	1637 = 119	3673 = 120	635 = 121	3767 = 122	1341 = 123	2914 = 124	3025 = 125	3613 = 126	2342 = 127	934 = 128	4416 = 129	4496 + e.k1517 + (e.k63
3862 = 130	4528 = 131	29 = 132	4624 = 133	4909 = 134	3479 = 135	2649 = 136	1543 = 137	4906 = 138	2221 = 139	2795 = 140	4484 = 141	4217 = 142	2201 + e.k1490 + (e.k3707
4829 = 143	380 = 144	1948 = 145	3994 = 146	2821 = 147	2359 = 148	4044 = 149	1305 = 150	3629 = 151	1898 = 152	1709 = 153	3584 = 154	1890 = 155	2362 + e.k2325 + (e.k4032
3456 = 156	2867 = 157	4926 = 158	2214 = 159	3819 = 160	3878 = 161	1448 = 162	1942 = 163	4476 = 164	2744 = 165	2955 = 166	2085 = 167	3558 = 168	3208 + e.k2525 + (e.k1018
3577 = 169	4069 = 170	2096 = 171	4977 = 172	2166 = 173	3135 = 174	3591 = 175	3224 = 176	3285 = 177	3462 = 178	4731 = 179	1181 = 180	4283 = 181	4189 + e.k3558 + (e.k2671
4488 = 182	3561 = 183	4592 = 184	1919 = 185	1246 = 186	1591 = 187	756 = 188	2918 = 189	1010 = 190	127 = 191	4312 = 192	432 = 193	2257 = 194	3224 + e.k2933 + (e.k2596
240 = 195	1441 = 196	4056 = 197	862 = 198	3778 = 199	162 = 200	1354 = 201	2677 = 202	104 = 203	438 = 204	3205 = 205	2581 = 206	3881 = 207	4530 + e.k4909 + (e.k2920
4022 = 208	1967 = 209	4839 = 210	874 = 211	279 = 212	4904 = 213	1965 = 214	3894 = 215	3050 = 216	2961 = 217	3929 = 218	900 = 219	3395 = 220	3050 + e.k3940 + (e.k1793
3503 = 221	3955 = 222	1836 = 223	1640 = 224	1297 = 225	4027 = 226	3982 = 227	2239 = 228	1902 = 229	4813 = 230	475 = 231	749 = 232	1977 = 233	4056 + e.k4947 + (e.k54
450 = 234	1535 = 235	2710 = 236	4140 = 237	3257 = 238	833 = 239	1862 = 240	89 = 241	4800 = 242	2155 = 243	263 = 244	2731 = 245	1976 = 246	2677 + e.k1341 + (e.k2457
3950 = 247	3729 = 248	1606 = 249	4175 = 250	1455 = 251	2058 = 252	695 = 253	843 = 254	284 = 255	898 = 256	689 = 257	357 = 258	4444 = 259	4128 + e.k450 + (e.k4776`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e15 = fill15(born());
function fill16(e) {`,
      [
        `2077 = 0	3304 = 1	144 = 2	2030 = 3	2616 = 4	4894 = 5	4265 = 6	3528 = 7	4434 = 8	3482 = 9	4262 = 10	3020 = 11	4514 = 12	3020 + e.k4262 + (e.k653
860 = 13	4030 = 14	4031 = 15	4953 = 16	2072 = 17	2440 = 18	3515 = 19	4879 = 20	3931 = 21	642 = 22	2909 = 23	1277 = 24	4695 = 25	4262 + e.k4879 + (e.k4057
968 = 26	3239 = 27	1815 = 28	1043 = 29	203 = 30	1118 = 31	4565 = 32	2477 = 33	3013 = 34	103 = 35	4061 = 36	1399 = 37	372 = 38	4894 + e.k2030 + (e.k1452
4491 = 39	3837 = 40	552 = 41	3693 = 42	1909 = 43	161 = 44	4132 = 45	1917 = 46	3818 = 47	4163 = 48	143 = 49	4667 = 50	4944 = 51	1277 + e.k3515 + (e.k1909
1517 = 52	4302 = 53	4276 = 54	1514 = 55	1832 = 56	556 = 57	1539 = 58	2354 = 59	4296 = 60	4882 = 61	4052 = 62	3770 = 63	3418 = 64	2909 + e.k4302 + (e.k2350
4620 = 65	4740 = 66	3920 = 67	3367 = 68	3780 = 69	4354 = 70	2999 = 71	1637 = 72	683 = 73	4524 = 74	4323 = 75	2028 = 76	4797 = 77	4030 + e.k3818 + (e.k213
838 = 78	568 = 79	2355 = 80	2033 = 81	1235 = 82	4500 = 83	3575 = 84	4974 = 85	2893 = 86	3516 = 87	1961 = 88	1411 = 89	2487 = 90	2893 + e.k3920 + (e.k1306
55 = 91	1132 = 92	2611 = 93	3828 = 94	2570 = 95	4148 = 96	3668 = 97	545 = 98	4707 = 99	174 = 100	4533 = 101	4784 = 102	3334 = 103	2893 + e.k4514 + (e.k3971
3675 = 104	3659 = 105	4224 = 106	2321 = 107	2571 = 108	1706 = 109	2197 = 110	3422 = 111	1905 = 112	4562 = 113	4257 = 114	3514 = 115	2983 = 116	4262 + e.k3367 + (e.k1147
2302 = 117	86 = 118	2279 = 119	3900 = 120	4412 = 121	1122 = 122	615 = 123	630 = 124	2289 = 125	157 = 126	1268 = 127	560 = 128	2443 = 129	2289 + e.k3837 + (e.k2434
2845 = 130	4286 = 131	1459 = 132	774 = 133	3103 = 134	1844 = 135	2728 = 136	2369 = 137	1155 = 138	3703 = 139	2101 = 140	480 = 141	4758 = 142	3422 + e.k4286 + (e.k4147
4929 = 143	4802 = 144	4817 = 145	3438 = 146	3928 = 147	3108 = 148	563 = 149	4656 = 150	4674 = 151	1472 = 152	4273 = 153	2393 = 154	4517 = 155	774 + e.k568 + (e.k3064
523 = 156	4910 = 157	3015 = 158	4049 = 159	381 = 160	2806 = 161	1879 = 162	1683 = 163	4243 = 164	1108 = 165	4901 = 166	4516 = 167	2189 = 168	1637 + e.k3528 + (e.k287
2093 = 169	4762 = 170	3854 = 171	1983 = 172	3819 = 173	352 = 174	2883 = 175	4518 = 176	4757 = 177	3428 = 178	1222 = 179	2073 = 180	1563 = 181	4707 + e.k143 + (e.k867
970 = 182	3186 = 183	222 = 184	4303 = 185	3723 = 186	3298 = 187	1147 = 188	4984 = 189	3070 = 190	2676 = 191	2344 = 192	2850 = 193	1999 = 194	4516 + e.k2197 + (e.k4326
1601 = 195	3547 = 196	3292 = 197	1461 = 198	729 = 199	897 = 200	1274 = 201	2468 = 202	3157 = 203	3018 = 204	3100 = 205	2015 = 206	2742 = 207	1155 + e.k4491 + (e.k608
2481 = 208	2964 = 209	1990 = 210	1315 = 211	1291 = 212	3278 = 213	765 = 214	2377 = 215	2898 = 216	2160 = 217	1446 = 218	3505 = 219	1695 = 220	2983 + e.k2898 + (e.k2153
855 = 221	2211 = 222	3144 = 223	3710 = 224	3384 = 225	1380 = 226	4857 = 227	3756 = 228	566 = 229	227 = 230	2985 = 231	4641 = 232	2687 = 233	3422 + e.k3703 + (e.k1106
3276 = 234	2944 = 235	61 = 236	4000 = 237	609 = 238	3463 = 239	80 = 240	3973 = 241	428 = 242	661 = 243	1209 = 244	2615 = 245	1925 = 246	3298 + e.k3367 + (e.k4926
1272 = 247	3386 = 248	4725 = 249	3678 = 250	1988 = 251	2226 = 252	2540 = 253	2724 = 254	2854 = 255	2649 = 256	1989 = 257	499 = 258	4383 = 259	4323 + e.k1209 + (e.k853`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e16 = fill16(born());
function fill17(e) {`,
      [
        `1407 = 0	3743 = 1	3630 = 2	4363 = 3	344 = 4	63 = 5	2408 = 6	4670 = 7	924 = 8	3198 = 9	3924 = 10	2642 = 11	2344 = 12	3924 + e.k3743 + (e.k708
1966 = 13	2584 = 14	4265 = 15	2379 = 16	2773 = 17	3214 = 18	3829 = 19	15 = 20	2996 = 21	495 = 22	301 = 23	3161 = 24	2483 = 25	2584 + e.k2483 + (e.k1389
4458 = 26	401 = 27	4418 = 28	857 = 29	4735 = 30	3574 = 31	3350 = 32	796 = 33	2812 = 34	3681 = 35	1704 = 36	4010 = 37	4009 = 38	796 + e.k495 + (e.k747
3506 = 39	1907 = 40	4309 = 41	451 = 42	1985 = 43	1360 = 44	3903 = 45	4994 = 46	2710 = 47	4210 = 48	4190 = 49	3175 = 50	3117 = 51	3214 + e.k4190 + (e.k1002
3241 = 52	3687 = 53	208 = 54	3839 = 55	1385 = 56	2223 = 57	4560 = 58	1228 = 59	674 = 60	4152 = 61	3735 = 62	648 = 63	371 = 64	371 + e.k3198 + (e.k1760
4016 = 65	2356 = 66	4185 = 67	398 = 68	3373 = 69	1466 = 70	2590 = 71	1616 = 72	4089 = 73	4224 = 74	315 = 75	3195 = 76	1476 = 77	4152 + e.k1616 + (e.k1400
3879 = 78	890 = 79	1490 = 80	4164 = 81	1411 = 82	3768 = 83	1726 = 84	1358 = 85	3747 = 86	2186 = 87	4045 = 88	1526 = 89	1372 = 90	3195 + e.k3214 + (e.k4799
2596 = 91	337 = 92	489 = 93	1733 = 94	2061 = 95	3467 = 96	3738 = 97	1173 = 98	977 = 99	4447 = 100	3816 = 101	2524 = 102	571 = 103	3924 + e.k3175 + (e.k3540
2321 = 104	701 = 105	4918 = 106	462 = 107	958 = 108	1503 = 109	2435 = 110	1436 = 111	280 = 112	1479 = 113	614 = 114	2989 = 115	4626 = 116	3117 + e.k1704 + (e.k399
911 = 117	316 = 118	3127 = 119	3385 = 120	1007 = 121	1883 = 122	2112 = 123	669 = 124	3154 = 125	1694 = 126	3197 = 127	3939 = 128	80 = 129	2524 + e.k857 + (e.k981
1412 = 130	2622 = 131	291 = 132	1317 = 133	3074 = 134	1828 = 135	3589 = 136	2195 = 137	1301 = 138	624 = 139	3745 = 140	650 = 141	2111 = 142	3214 + e.k4458 + (e.k3880
1021 = 143	4637 = 144	696 = 145	4710 = 146	4630 = 147	3660 = 148	4118 = 149	3835 = 150	51 = 151	3783 = 152	3654 = 153	1468 = 154	2743 = 155	462 + e.k1385 + (e.k1937
4813 = 156	1141 = 157	2224 = 158	3592 = 159	4057 = 160	2835 = 161	234 = 162	2436 = 163	4925 = 164	3790 = 165	4572 = 166	1797 = 167	1380 = 168	3783 + e.k4630 + (e.k4790
3591 = 169	1771 = 170	2250 = 171	2971 = 172	2367 = 173	4522 = 174	676 = 175	2626 = 176	452 = 177	1150 = 178	518 = 179	2303 = 180	196 = 181	3839 + e.k2524 + (e.k1215
2433 = 182	3910 = 183	1675 = 184	119 = 185	2942 = 186	3695 = 187	3572 = 188	413 = 189	1752 = 190	4965 = 191	4951 = 192	4426 = 193	4441 = 194	1526 + e.k3681 + (e.k4576
576 = 195	4012 = 196	4593 = 197	3595 = 198	4283 = 199	709 = 200	2494 = 201	1052 = 202	1827 = 203	4555 = 204	1276 = 205	4674 = 206	3958 = 207	1150 + e.k2061 + (e.k101
2153 = 208	3005 = 209	3928 = 210	4796 = 211	2262 = 212	1578 = 213	4974 = 214	3561 = 215	2116 = 216	3068 = 217	1671 = 218	4869 = 219	4143 = 220	3654 + e.k1883 + (e.k621
3084 = 221	4348 = 222	2455 = 223	2614 = 224	2938 = 225	35 = 226	2183 = 227	2884 = 228	1130 = 229	1051 = 230	1449 = 231	773 = 232	3172 = 233	2996 + e.k958 + (e.k2890
4354 = 234	4031 = 235	2789 = 236	3067 = 237	2625 = 238	428 = 239	1984 = 240	908 = 241	2647 = 242	2441 = 243	4721 = 244	67 = 245	3533 = 246	2584 + e.k2625 + (e.k4818
2513 = 247	3114 = 248	4573 = 249	3711 = 250	658 = 251	2442 = 252	3877 = 253	468 = 254	2332 = 255	200 = 256	2771 = 257	781 = 258	646 = 259	2938 + e.k4447 + (e.k3164`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e17 = fill17(born());
function fill18(e) {`,
      [
        `3755 = 0	1183 = 1	119 = 2	4212 = 3	2921 = 4	571 = 5	2588 = 6	1130 = 7	3261 = 8	4164 = 9	4407 = 10	4795 = 11	1743 = 12	4164 + e.k119 + (e.k939
4048 = 13	4778 = 14	2552 = 15	3216 = 16	428 = 17	3943 = 18	4885 = 19	3677 = 20	1178 = 21	1416 = 22	3274 = 23	2383 = 24	300 = 25	3261 + e.k1130 + (e.k4261
778 = 26	3529 = 27	1811 = 28	3363 = 29	594 = 30	3737 = 31	1488 = 32	1530 = 33	3959 = 34	1460 = 35	4479 = 36	2082 = 37	1171 = 38	594 + e.k4212 + (e.k897
4701 = 39	1795 = 40	12 = 41	4949 = 42	1572 = 43	1961 = 44	4900 = 45	226 = 46	4442 = 47	1086 = 48	2470 = 49	1741 = 50	2539 = 51	2470 + e.k1961 + (e.k961
4915 = 52	4597 = 53	4146 = 54	2182 = 55	4530 = 56	1914 = 57	3275 = 58	1953 = 59	3976 = 60	693 = 61	2081 = 62	470 = 63	2332 = 64	2539 + e.k3216 + (e.k626
4760 = 65	3828 = 66	707 = 67	1199 = 68	2287 = 69	1198 = 70	3698 = 71	4127 = 72	4816 = 73	46 = 74	3469 = 75	3140 = 76	3499 = 77	707 + e.k707 + (e.k764
2957 = 78	1479 = 79	2532 = 80	550 = 81	1994 = 82	3934 = 83	141 = 84	40 = 85	3672 = 86	4994 = 87	3945 = 88	2612 = 89	1897 = 90	1130 + e.k4479 + (e.k3688
3832 = 91	1637 = 92	4092 = 93	3724 = 94	2894 = 95	2788 = 96	928 = 97	2883 = 98	1157 = 99	1055 = 100	2878 = 101	1418 = 102	3433 = 103	707 + e.k2287 + (e.k3661
3500 = 104	931 = 105	2392 = 106	255 = 107	2062 = 108	3914 = 109	4076 = 110	340 = 111	4901 = 112	4294 = 113	979 = 114	3045 = 115	3859 = 116	3934 + e.k3914 + (e.k3276
86 = 117	3892 = 118	4870 = 119	4505 = 120	3739 = 121	4374 = 122	3002 = 123	4322 = 124	2458 = 125	1943 = 126	1557 = 127	509 = 128	4105 = 129	40 + e.k2612 + (e.k4119
4728 = 130	2553 = 131	1813 = 132	2998 = 133	4063 = 134	16 = 135	2617 = 136	1711 = 137	1450 = 138	3245 = 139	4079 = 140	3846 = 141	2837 = 142	4597 + e.k693 + (e.k3008
912 = 143	3198 = 144	2692 = 145	752 = 146	4432 = 147	3631 = 148	1323 = 149	4140 = 150	4150 = 151	2144 = 152	3560 = 153	2129 = 154	3870 = 155	4407 + e.k4146 + (e.k235
584 = 156	1738 = 157	304 = 158	1901 = 159	3090 = 160	4850 = 161	1854 = 162	4867 = 163	1333 = 164	1809 = 165	4807 = 166	745 = 167	544 = 168	2470 + e.k2612 + (e.k3445
467 = 169	2386 = 170	1064 = 171	214 = 172	3985 = 173	2406 = 174	4125 = 175	2509 = 176	2502 = 177	1254 = 178	1424 = 179	4273 = 180	768 = 181	3002 + e.k1333 + (e.k3588
2500 = 182	2253 = 183	4241 = 184	2294 = 185	2461 = 186	826 = 187	2341 = 188	2121 = 189	4674 = 190	2643 = 191	3029 = 192	1217 = 193	492 = 194	1738 + e.k4530 + (e.k3862
710 = 195	3165 = 196	3778 = 197	1011 = 198	4207 = 199	275 = 200	2239 = 201	2956 = 202	674 = 203	4379 = 204	718 = 205	193 = 206	4362 = 207	2182 + e.k3631 + (e.k2092
4943 = 208	2809 = 209	1213 = 210	4028 = 211	4158 = 212	502 = 213	673 = 214	1221 = 215	4465 = 216	1544 = 217	3768 = 218	297 = 219	1956 = 220	4158 + e.k3500 + (e.k3660
4619 = 221	2416 = 222	4400 = 223	424 = 224	4905 = 225	1632 = 226	653 = 227	4797 = 228	2626 = 229	747 = 230	742 = 231	503 = 232	2575 = 233	2294 + e.k2332 + (e.k690
1492 = 234	3395 = 235	2730 = 236	4706 = 237	1394 = 238	606 = 239	70 = 240	552 = 241	4947 = 242	1039 = 243	4215 = 244	2989 = 245	1542 = 246	4241 + e.k3859 + (e.k1722
4903 = 247	1272 = 248	1124 = 249	1873 = 250	3584 = 251	1734 = 252	699 = 253	4590 = 254	1836 = 255	122 = 256	2912 = 257	63 = 258	3435 = 259	4105 + e.k2182 + (e.k2382`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e18 = fill18(born());
function fill19(e) {`,
      [
        `224 = 0	2769 = 1	230 = 2	1622 = 3	2817 = 4	4721 = 5	3138 = 6	331 = 7	1786 = 8	1951 = 9	2159 = 10	1482 = 11	1266 = 12	1786 + e.k1951 + (e.k3059
87 = 13	1088 = 14	291 = 15	1538 = 16	59 = 17	2567 = 18	4645 = 19	4165 = 20	3111 = 21	1458 = 22	627 = 23	142 = 24	463 = 25	1266 + e.k1786 + (e.k2251
223 = 26	2757 = 27	1501 = 28	3511 = 29	2675 = 30	51 = 31	2633 = 32	2870 = 33	1047 = 34	115 = 35	4670 = 36	1723 = 37	3368 = 38	2567 + e.k1088 + (e.k2693
2610 = 39	486 = 40	1432 = 41	4979 = 42	2749 = 43	922 = 44	2463 = 45	3600 = 46	2588 = 47	1806 = 48	2016 = 49	784 = 50	1026 = 51	4721 + e.k51 + (e.k959
2601 = 52	2909 = 53	549 = 54	4757 = 55	1860 = 56	4325 = 57	398 = 58	3310 = 59	4461 = 60	900 = 61	3984 = 62	2280 = 63	1464 = 64	1464 + e.k2280 + (e.k4899
4292 = 65	1983 = 66	321 = 67	124 = 68	745 = 69	312 = 70	1702 = 71	2451 = 72	189 = 73	2440 = 74	2580 = 75	4419 = 76	4082 = 77	463 + e.k1026 + (e.k1691
3999 = 78	725 = 79	4311 = 80	16 = 81	3231 = 82	2032 = 83	1434 = 84	2860 = 85	2628 = 86	385 = 87	3284 = 88	17 = 89	3505 = 90	4292 + e.k4721 + (e.k143
3926 = 91	1082 = 92	505 = 93	2155 = 94	2405 = 95	774 = 96	3331 = 97	3499 = 98	4736 = 99	1035 = 100	4114 = 101	3088 = 102	4559 = 103	3088 + e.k1983 + (e.k264
2765 = 104	3335 = 105	3605 = 106	2095 = 107	4346 = 108	649 = 109	2146 = 110	4463 = 111	1418 = 112	2914 = 113	4806 = 114	1606 = 115	1064 = 116	3605 + e.k1088 + (e.k3738
3958 = 117	4075 = 118	3649 = 119	4643 = 120	4734 = 121	3172 = 122	2563 = 123	3035 = 124	3000 = 125	1855 = 126	558 = 127	4669 = 128	1121 = 129	2675 + e.k2159 + (e.k2830
2551 = 130	1782 = 131	1264 = 132	171 = 133	710 = 134	2157 = 135	2725 = 136	4689 = 137	3590 = 138	766 = 139	986 = 140	3575 = 141	3112 = 142	4734 + e.k4645 + (e.k1788
3792 = 143	2604 = 144	756 = 145	4076 = 146	1591 = 147	1140 = 148	3343 = 149	426 = 150	2393 = 151	4785 = 152	4701 = 153	1745 = 154	2640 = 155	4689 + e.k4645 + (e.k250
3269 = 156	744 = 157	3338 = 158	501 = 159	4007 = 160	862 = 161	1169 = 162	3053 = 163	780 = 164	1994 = 165	670 = 166	380 = 167	4398 = 168	51 + e.k2769 + (e.k1848
1687 = 169	2758 = 170	2915 = 171	628 = 172	1044 = 173	3522 = 174	1290 = 175	3630 = 176	400 = 177	2751 = 178	4054 = 179	1463 = 180	4147 = 181	780 + e.k1047 + (e.k4523
2025 = 182	3363 = 183	2151 = 184	4763 = 185	454 = 186	1894 = 187	3741 = 188	2582 = 189	2717 = 190	693 = 191	3540 = 192	2424 = 193	4141 = 194	1026 + e.k224 + (e.k2006
2285 = 195	4551 = 196	434 = 197	2813 = 198	2013 = 199	2907 = 200	4309 = 201	838 = 202	1890 = 203	1355 = 204	4593 = 205	3125 = 206	3799 = 207	1622 + e.k2717 + (e.k1218
304 = 208	3184 = 209	4417 = 210	2225 = 211	1706 = 212	4530 = 213	1901 = 214	835 = 215	824 = 216	608 = 217	3834 = 218	4830 = 219	2199 = 220	1606 + e.k670 + (e.k3227
3121 = 221	3204 = 222	4866 = 223	2847 = 224	2805 = 225	743 = 226	2698 = 227	516 = 228	1891 = 229	4914 = 230	2948 = 231	2114 = 232	5 = 233	2013 + e.k171 + (e.k2601
644 = 234	1686 = 235	4327 = 236	817 = 237	1350 = 238	3029 = 239	1295 = 240	3831 = 241	1499 = 242	2903 = 243	1206 = 244	2401 = 245	1945 = 246	4165 + e.k1894 + (e.k4586
2992 = 247	4909 = 248	151 = 249	238 = 250	2950 = 251	276 = 252	4272 = 253	3074 = 254	2281 = 255	4568 = 256	4832 = 257	1021 = 258	3963 = 259	1687 + e.k59 + (e.k4883`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e19 = fill19(born());
function fill20(e) {`,
      [
        `287 = 0	3464 = 1	4694 = 2	3610 = 3	4684 = 4	307 = 5	208 = 6	1836 = 7	3665 = 8	2410 = 9	3952 = 10	3900 = 11	3437 = 12	3437 + e.k4684 + (e.k1208
1837 = 13	54 = 14	3617 = 15	690 = 16	3537 = 17	755 = 18	826 = 19	101 = 20	919 = 21	2620 = 22	2488 = 23	1690 = 24	1782 = 25	3665 + e.k54 + (e.k4633
1027 = 26	345 = 27	933 = 28	2349 = 29	3287 = 30	4509 = 31	3440 = 32	626 = 33	4414 = 34	4344 = 35	3903 = 36	4262 = 37	557 = 38	2488 + e.k4694 + (e.k4378
2790 = 39	1288 = 40	245 = 41	2012 = 42	1552 = 43	1521 = 44	2880 = 45	1346 = 46	1269 = 47	3066 = 48	1310 = 49	3919 = 50	1765 = 51	3066 + e.k3900 + (e.k3201
4054 = 52	163 = 53	989 = 54	3498 = 55	4368 = 56	4503 = 57	3508 = 58	747 = 59	3635 = 60	3375 = 61	1909 = 62	879 = 63	2622 = 64	3919 + e.k989 + (e.k713
282 = 65	476 = 66	156 = 67	2380 = 68	511 = 69	2633 = 70	3268 = 71	4841 = 72	3390 = 73	534 = 74	4564 = 75	3913 = 76	4044 = 77	1027 + e.k3464 + (e.k349
2797 = 78	292 = 79	3784 = 80	1335 = 81	548 = 82	1884 = 83	236 = 84	1313 = 85	190 = 86	2824 = 87	183 = 88	3858 = 89	3094 = 90	3665 + e.k548 + (e.k4283
928 = 91	3166 = 92	966 = 93	1815 = 94	1964 = 95	4717 = 96	2926 = 97	3343 = 98	3522 = 99	575 = 100	781 = 101	3848 = 102	3468 = 103	933 + e.k3858 + (e.k1066
3763 = 104	2124 = 105	4549 = 106	3801 = 107	2594 = 108	3295 = 109	4256 = 110	3882 = 111	491 = 112	3184 = 113	1582 = 114	3591 = 115	1129 = 116	190 + e.k2797 + (e.k3594
123 = 117	2224 = 118	1636 = 119	3171 = 120	4950 = 121	3910 = 122	3724 = 123	3021 = 124	1309 = 125	3194 = 126	4111 = 127	4612 = 128	4107 = 129	183 + e.k534 + (e.k1469
1459 = 130	4655 = 131	1698 = 132	4433 = 133	4776 = 134	3029 = 135	227 = 136	2099 = 137	4017 = 138	2138 = 139	3685 = 140	2406 = 141	1925 = 142	101 + e.k2099 + (e.k2175
1354 = 143	4121 = 144	2377 = 145	1038 = 146	3727 = 147	3048 = 148	3741 = 149	687 = 150	4004 = 151	3276 = 152	3693 = 153	3928 = 154	3284 = 155	2099 + e.k1459 + (e.k1455
2756 = 156	4363 = 157	741 = 158	1358 = 159	2768 = 160	1465 = 161	4226 = 162	3355 = 163	4043 = 164	3356 = 165	4129 = 166	2054 = 167	4855 = 168	4363 + e.k4950 + (e.k3103
0 = 169	398 = 170	1671 = 171	4060 = 172	4409 = 173	2048 = 174	4772 = 175	1034 = 176	3792 = 177	4384 = 178	2874 = 179	4157 = 180	1114 = 181	4157 + e.k3727 + (e.k4124
926 = 182	4858 = 183	3746 = 184	1612 = 185	3109 = 186	3384 = 187	4784 = 188	42 = 189	2169 = 190	3 = 191	4361 = 192	4475 = 193	4143 = 194	3171 + e.k4044 + (e.k2228
4704 = 195	182 = 196	2315 = 197	3803 = 198	4037 = 199	2644 = 200	4497 = 201	4709 = 202	1072 = 203	4840 = 204	3793 = 205	3611 = 206	158 = 207	933 + e.k3021 + (e.k668
3034 = 208	4512 = 209	4539 = 210	2202 = 211	1848 = 212	2812 = 213	613 = 214	3451 = 215	4407 = 216	213 = 217	3226 = 218	4186 = 219	2381 = 220	755 + e.k3591 + (e.k420
1351 = 221	620 = 222	3628 = 223	2687 = 224	2563 = 225	4538 = 226	1562 = 227	4452 = 228	2573 = 229	4842 = 230	4677 = 231	3421 = 232	2835 = 233	2048 + e.k919 + (e.k1922
1461 = 234	4065 = 235	2950 = 236	4560 = 237	2065 = 238	3452 = 239	3381 = 240	4134 = 241	4377 = 242	3285 = 243	2496 = 244	2102 = 245	3934 = 246	158 + e.k2102 + (e.k2369
3631 = 247	3172 = 248	571 = 249	793 = 250	779 = 251	4359 = 252	4173 = 253	2288 = 254	3419 = 255	822 = 256	1368 = 257	4516 = 258	2441 = 259	779 + e.k3452 + (e.k4117`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e20 = fill20(born());
function fill21(e) {`,
      [
        `1677 = 0	1259 = 1	2874 = 2	2060 = 3	4523 = 4	2967 = 5	1307 = 6	2811 = 7	3839 = 8	1078 = 9	3622 = 10	2211 = 11	4739 = 12	1078 + e.k3839 + (e.k3344
371 = 13	2009 = 14	2465 = 15	867 = 16	4677 = 17	538 = 18	450 = 19	4353 = 20	2015 = 21	2663 = 22	1894 = 23	3595 = 24	240 = 25	2060 + e.k4739 + (e.k4394
1932 = 26	3995 = 27	3186 = 28	3028 = 29	1800 = 30	313 = 31	2893 = 32	2126 = 33	1471 = 34	2971 = 35	4320 = 36	3126 = 37	1666 = 38	3126 + e.k2126 + (e.k4951
2496 = 39	107 = 40	3886 = 41	3842 = 42	408 = 43	1499 = 44	2866 = 45	4244 = 46	971 = 47	4725 = 48	4698 = 49	1180 = 50	1019 = 51	3995 + e.k2126 + (e.k585
3711 = 52	866 = 53	1744 = 54	965 = 55	3135 = 56	2488 = 57	3415 = 58	3380 = 59	1423 = 60	1727 = 61	4796 = 62	2478 = 63	4481 = 64	2126 + e.k2874 + (e.k3095
486 = 65	4991 = 66	1069 = 67	557 = 68	3532 = 69	1691 = 70	1087 = 71	4442 = 72	4846 = 73	3964 = 74	928 = 75	3758 = 76	237 = 77	1259 + e.k1894 + (e.k877
2205 = 78	3064 = 79	4802 = 80	3706 = 81	4050 = 82	2462 = 83	3112 = 84	549 = 85	4221 = 86	3184 = 87	1638 = 88	256 = 89	4056 = 90	3886 + e.k450 + (e.k880
2265 = 91	1238 = 92	3385 = 93	1043 = 94	4229 = 95	922 = 96	2950 = 97	3658 = 98	106 = 99	1926 = 100	1971 = 101	4443 = 102	315 = 103	1019 + e.k1971 + (e.k1207
2204 = 104	4094 = 105	4139 = 106	3137 = 107	3472 = 108	4505 = 109	837 = 110	3553 = 111	1701 = 112	2276 = 113	2708 = 114	1624 = 115	3790 = 116	4442 + e.k1932 + (e.k3532
1947 = 117	2674 = 118	3479 = 119	2189 = 120	4130 = 121	969 = 122	4370 = 123	2139 = 124	2649 = 125	2417 = 126	3195 = 127	4246 = 128	56 = 129	2811 + e.k1744 + (e.k1545
4619 = 130	308 = 131	3893 = 132	4865 = 133	3740 = 134	4808 = 135	1089 = 136	3136 = 137	1142 = 138	2557 = 139	2890 = 140	141 = 141	4962 = 142	2462 + e.k3136 + (e.k3981
875 = 143	476 = 144	1969 = 145	3029 = 146	566 = 147	2898 = 148	2865 = 149	1335 = 150	719 = 151	1872 = 152	4678 = 153	4364 = 154	2442 = 155	2060 + e.k1971 + (e.k84
2529 = 156	4549 = 157	4026 = 158	4705 = 159	1733 = 160	3881 = 161	4615 = 162	2293 = 163	123 = 164	2705 = 165	2251 = 166	2524 = 167	2087 = 168	1969 + e.k2465 + (e.k788
1505 = 169	1101 = 170	4950 = 171	93 = 172	535 = 173	1126 = 174	155 = 175	4928 = 176	1776 = 177	4507 = 178	2333 = 179	4145 = 180	3331 = 181	1677 + e.k4364 + (e.k4391
2069 = 182	4641 = 183	4023 = 184	4895 = 185	3815 = 186	2774 = 187	4167 = 188	4196 = 189	2471 = 190	820 = 191	2461 = 192	582 = 193	1282 = 194	1069 + e.k1180 + (e.k961
4265 = 195	3500 = 196	33 = 197	4904 = 198	3566 = 199	2321 = 200	985 = 201	2801 = 202	3953 = 203	1758 = 204	2127 = 205	3535 = 206	4474 = 207	4265 + e.k2126 + (e.k4578
4467 = 208	2754 = 209	3559 = 210	4556 = 211	409 = 212	4609 = 213	4378 = 214	2977 = 215	3991 = 216	3747 = 217	143 = 218	2213 = 219	3644 = 220	3028 + e.k4641 + (e.k2012
2158 = 221	630 = 222	2155 = 223	2991 = 224	223 = 225	3149 = 226	777 = 227	4855 = 228	2440 = 229	2596 = 230	2224 = 231	4502 = 232	2389 = 233	1126 + e.k2774 + (e.k1013
2362 = 234	265 = 235	2491 = 236	3937 = 237	4357 = 238	342 = 239	1913 = 240	463 = 241	1509 = 242	1923 = 243	2951 = 244	4201 = 245	4163 = 246	1758 + e.k922 + (e.k2755
986 = 247	4308 = 248	4423 = 249	2686 = 250	1793 = 251	580 = 252	2098 = 253	4669 = 254	699 = 255	4645 = 256	1852 = 257	576 = 258	3933 = 259	2754 + e.k2205 + (e.k4811`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e21 = fill21(born());
function fill22(e) {`,
      [
        `2862 = 0	4139 = 1	1611 = 2	2991 = 3	2595 = 4	3925 = 5	1459 = 6	3660 = 7	4479 = 8	314 = 9	3650 = 10	1006 = 11	1360 = 12	1459 + e.k4479 + (e.k3144
937 = 13	2801 = 14	4564 = 15	4849 = 16	494 = 17	2067 = 18	1091 = 19	1069 = 20	2567 = 21	1374 = 22	3840 = 23	4155 = 24	3877 = 25	3925 + e.k1360 + (e.k2458
3787 = 26	1788 = 27	1654 = 28	1243 = 29	1092 = 30	4948 = 31	3132 = 32	4732 = 33	3288 = 34	4533 = 35	4504 = 36	2481 = 37	4237 = 38	4479 + e.k2801 + (e.k3014
3529 = 39	2390 = 40	3471 = 41	3125 = 42	2181 = 43	672 = 44	319 = 45	4931 = 46	1757 = 47	3371 = 48	137 = 49	3475 = 50	3108 = 51	319 + e.k937 + (e.k2091
453 = 52	349 = 53	3706 = 54	778 = 55	470 = 56	2933 = 57	2769 = 58	2012 = 59	1253 = 60	2993 = 61	2915 = 62	132 = 63	4176 = 64	4176 + e.k1654 + (e.k492
823 = 65	2073 = 66	3752 = 67	3124 = 68	2807 = 69	4225 = 70	2281 = 71	3372 = 72	2062 = 73	1663 = 74	3476 = 75	2156 = 76	3701 = 77	2595 + e.k4479 + (e.k697
2310 = 78	4375 = 79	4114 = 80	2865 = 81	3400 = 82	1842 = 83	3117 = 84	1361 = 85	4052 = 86	751 = 87	2517 = 88	3880 = 89	3339 = 90	2067 + e.k4849 + (e.k857
360 = 91	1070 = 92	3516 = 93	3343 = 94	4152 = 95	1714 = 96	4110 = 97	258 = 98	2645 = 99	3967 = 100	2682 = 101	985 = 102	89 = 103	1374 + e.k4237 + (e.k2426
4283 = 104	3358 = 105	4800 = 106	1345 = 107	3781 = 108	834 = 109	108 = 110	2651 = 111	4754 = 112	2876 = 113	2975 = 114	4710 = 115	4745 = 116	3339 + e.k1091 + (e.k1536
4698 = 117	2357 = 118	1275 = 119	3446 = 120	236 = 121	944 = 122	1244 = 123	3634 = 124	1317 = 125	1450 = 126	1187 = 127	1269 = 128	161 = 129	2357 + e.k1070 + (e.k2090
3300 = 130	1844 = 131	528 = 132	987 = 133	3870 = 134	4520 = 135	3828 = 136	4761 = 137	2189 = 138	505 = 139	193 = 140	2944 = 141	3676 = 142	944 + e.k2067 + (e.k1267
2366 = 143	3083 = 144	1543 = 145	372 = 146	1462 = 147	3118 = 148	1863 = 149	3318 = 150	2699 = 151	3015 = 152	147 = 153	1945 = 154	957 = 155	4931 + e.k1269 + (e.k4825
3183 = 156	1371 = 157	2925 = 158	299 = 159	2087 = 160	976 = 161	2138 = 162	1480 = 163	4090 = 164	3576 = 165	435 = 166	388 = 167	2308 = 168	3650 + e.k3634 + (e.k4643
2534 = 169	175 = 170	2258 = 171	506 = 172	1357 = 173	1984 = 174	1730 = 175	3059 = 176	2624 = 177	1689 = 178	4269 = 179	45 = 180	1749 = 181	258 + e.k3701 + (e.k4181
4400 = 182	4772 = 183	1090 = 184	2391 = 185	3788 = 186	1331 = 187	3519 = 188	4916 = 189	2076 = 190	2972 = 191	1542 = 192	1302 = 193	2323 = 194	2138 + e.k823 + (e.k4112
4164 = 195	4153 = 196	2726 = 197	4303 = 198	4422 = 199	3846 = 200	4614 = 201	3185 = 202	3632 = 203	4886 = 204	2602 = 205	4228 = 206	4590 = 207	4164 + e.k1187 + (e.k1608
4160 = 208	2903 = 209	1489 = 210	1558 = 211	4307 = 212	4399 = 213	3313 = 214	949 = 215	4678 = 216	664 = 217	677 = 218	2724 = 219	2629 = 220	4400 + e.k2925 + (e.k3259
2435 = 221	2695 = 222	3235 = 223	708 = 224	298 = 225	3072 = 226	2193 = 227	3002 = 228	4892 = 229	3383 = 230	2743 = 231	564 = 232	1227 = 233	2138 + e.k435 + (e.k4495
1082 = 234	337 = 235	4543 = 236	3062 = 237	1907 = 238	3561 = 239	3680 = 240	2974 = 241	2783 = 242	3975 = 243	428 = 244	1451 = 245	1857 = 246	1984 + e.k428 + (e.k1627
2008 = 247	4502 = 248	1356 = 249	4276 = 250	48 = 251	3009 = 252	4594 = 253	625 = 254	3703 = 255	1337 = 256	327 = 257	1202 = 258	384 = 259	2645 + e.k1361 + (e.k1619`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e22 = fill22(born());
function fill23(e) {`,
      [
        `2840 = 0	729 = 1	3568 = 2	4423 = 3	168 = 4	2553 = 5	1098 = 6	1804 = 7	2230 = 8	1553 = 9	606 = 10	2184 = 11	4697 = 12	2553 + e.k2230 + (e.k4450
2732 = 13	3123 = 14	2778 = 15	4605 = 16	2922 = 17	3942 = 18	4292 = 19	1699 = 20	1661 = 21	2979 = 22	1360 = 23	1224 = 24	2004 = 25	1661 + e.k1699 + (e.k472
3891 = 26	1251 = 27	3391 = 28	933 = 29	3246 = 30	4771 = 31	1437 = 32	2958 = 33	1628 = 34	3648 = 35	3970 = 36	4103 = 37	264 = 38	1553 + e.k1699 + (e.k3709
4963 = 39	2152 = 40	3474 = 41	868 = 42	3820 = 43	1262 = 44	202 = 45	1449 = 46	315 = 47	1173 = 48	2436 = 49	2392 = 50	4850 = 51	3474 + e.k2230 + (e.k75
2577 = 52	2262 = 53	3164 = 54	4486 = 55	4956 = 56	4666 = 57	1086 = 58	1256 = 59	3271 = 60	2292 = 61	2089 = 62	1438 = 63	803 = 64	1661 + e.k1449 + (e.k102
3038 = 65	572 = 66	3316 = 67	3349 = 68	4396 = 69	1627 = 70	159 = 71	2844 = 72	2917 = 73	855 = 74	1791 = 75	251 = 76	1461 = 77	1256 + e.k3123 + (e.k525
40 = 78	4307 = 79	4707 = 80	328 = 81	1544 = 82	4617 = 83	4473 = 84	1071 = 85	873 = 86	575 = 87	230 = 88	3549 = 89	188 = 90	2553 + e.k251 + (e.k2716
489 = 91	523 = 92	3149 = 93	4308 = 94	2059 = 95	2208 = 96	1633 = 97	877 = 98	691 = 99	112 = 100	2658 = 101	2428 = 102	1712 = 103	1251 + e.k4956 + (e.k1954
1721 = 104	4094 = 105	1598 = 106	375 = 107	3322 = 108	376 = 109	1722 = 110	2619 = 111	4210 = 112	2881 = 113	796 = 114	4591 = 115	787 = 116	3891 + e.k3568 + (e.k1321
4064 = 117	719 = 118	4604 = 119	3692 = 120	1420 = 121	2989 = 122	3798 = 123	1075 = 124	3804 = 125	1340 = 126	2945 = 127	2118 = 128	3835 = 129	4605 + e.k523 + (e.k2100
4360 = 130	60 = 131	2221 = 132	4057 = 133	3760 = 134	4632 = 135	286 = 136	3274 = 137	2040 = 138	1066 = 139	2518 = 140	1492 = 141	4303 = 142	3549 + e.k1699 + (e.k2203
19 = 143	2193 = 144	1374 = 145	2909 = 146	3436 = 147	3126 = 148	1339 = 149	2120 = 150	4006 = 151	3557 = 152	1088 = 153	864 = 154	3566 = 155	2392 + e.k4103 + (e.k1343
1423 = 156	253 = 157	3859 = 158	1733 = 159	4268 = 160	1441 = 161	629 = 162	4288 = 163	4625 = 164	135 = 165	724 = 166	4276 = 167	2222 = 168	3391 + e.k719 + (e.k213
2283 = 169	620 = 170	1681 = 171	1454 = 172	2250 = 173	1890 = 174	469 = 175	4528 = 176	2014 = 177	2204 = 178	2103 = 179	432 = 180	4169 = 181	2118 + e.k2979 + (e.k2582
1055 = 182	917 = 183	3072 = 184	3575 = 185	3541 = 186	203 = 187	4859 = 188	1667 = 189	910 = 190	2217 = 191	1682 = 192	753 = 193	2797 = 194	2184 + e.k1544 + (e.k1799
4503 = 195	1347 = 196	3409 = 197	2043 = 198	4362 = 199	373 = 200	4145 = 201	4612 = 202	573 = 203	3511 = 204	2618 = 205	1891 = 206	2641 = 207	4604 + e.k2618 + (e.k3737
783 = 208	3588 = 209	2450 = 210	2134 = 211	2697 = 212	1171 = 213	2458 = 214	3426 = 215	1327 = 216	3597 = 217	2588 = 218	3604 = 219	3883 = 220	4292 + e.k4771 + (e.k144
2888 = 221	1879 = 222	314 = 223	1893 = 224	4366 = 225	2443 = 226	4309 = 227	2216 = 228	2186 = 229	622 = 230	4510 = 231	2021 = 232	567 = 233	1891 + e.k60 + (e.k1961
4695 = 234	45 = 235	142 = 236	1533 = 237	2357 = 238	4306 = 239	2651 = 240	3897 = 241	1446 = 242	1933 = 243	1738 = 244	1478 = 245	3203 = 246	188 + e.k620 + (e.k1235
2207 = 247	3685 = 248	162 = 249	2394 = 250	166 = 251	3581 = 252	1757 = 253	134 = 254	945 = 255	2356 = 256	241 = 257	2568 = 258	4978 = 259	1890 + e.k4362 + (e.k1114`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e23 = fill23(born());
function fill24(e) {`,
      [
        `4126 = 0	1678 = 1	3779 = 2	514 = 3	2933 = 4	2829 = 5	1664 = 6	1349 = 7	4028 = 8	3470 = 9	2233 = 10	3591 = 11	4835 = 12	514 + e.k2829 + (e.k2446
1485 = 13	1568 = 14	3501 = 15	412 = 16	1450 = 17	1856 = 18	680 = 19	3883 = 20	2194 = 21	1797 = 22	4258 = 23	4273 = 24	4767 = 25	1664 + e.k1485 + (e.k497
4058 = 26	3015 = 27	1919 = 28	4971 = 29	2186 = 30	329 = 31	1758 = 32	2968 = 33	2637 = 34	3336 = 35	1910 = 36	1509 = 37	2745 = 38	2829 + e.k4028 + (e.k4518
57 = 39	3278 = 40	2079 = 41	4570 = 42	2361 = 43	3685 = 44	3199 = 45	4489 = 46	3117 = 47	626 = 48	1478 = 49	2704 = 50	3822 = 51	3779 + e.k3501 + (e.k24
1911 = 52	360 = 53	171 = 54	1313 = 55	2992 = 56	2917 = 57	3387 = 58	813 = 59	1724 = 60	1701 = 61	3209 = 62	73 = 63	4037 = 64	4971 + e.k3015 + (e.k3946
195 = 65	70 = 66	4579 = 67	4916 = 68	3723 = 69	4006 = 70	4525 = 71	1297 = 72	1104 = 73	2147 = 74	1083 = 75	3760 = 76	3850 = 77	2933 + e.k1297 + (e.k1048
1237 = 78	1956 = 79	4528 = 80	1525 = 81	3930 = 82	2300 = 83	344 = 84	4457 = 85	2112 = 86	2205 = 87	4319 = 88	906 = 89	1319 = 90	2300 + e.k3336 + (e.k918
567 = 91	720 = 92	3592 = 93	1167 = 94	3704 = 95	936 = 96	1071 = 97	3546 = 98	104 = 99	3186 = 100	2530 = 101	355 = 102	2291 = 103	3883 + e.k1167 + (e.k204
2362 = 104	3275 = 105	3982 = 106	2799 = 107	3730 = 108	970 = 109	4422 = 110	4671 = 111	2458 = 112	547 = 113	2401 = 114	1428 = 115	2247 = 116	4319 + e.k3501 + (e.k2097
3943 = 117	1624 = 118	3431 = 119	884 = 120	1053 = 121	497 = 122	4432 = 123	449 = 124	3515 = 125	4862 = 126	2905 = 127	1618 = 128	4063 = 129	2968 + e.k2300 + (e.k1248
4055 = 130	2368 = 131	2319 = 132	4026 = 133	3513 = 134	2153 = 135	2506 = 136	3688 = 137	372 = 138	1982 = 139	4618 = 140	3925 = 141	1141 = 142	4126 + e.k813 + (e.k2901
560 = 143	4013 = 144	2000 = 145	2174 = 146	1077 = 147	2904 = 148	86 = 149	4170 = 150	2526 = 151	4220 = 152	204 = 153	3174 = 154	565 = 155	344 + e.k680 + (e.k4107
945 = 156	903 = 157	3919 = 158	3025 = 159	4344 = 160	917 = 161	4969 = 162	3644 = 163	2459 = 164	2415 = 165	4177 = 166	975 = 167	1059 = 168	2361 + e.k4618 + (e.k3455
3110 = 169	505 = 170	872 = 171	739 = 172	1522 = 173	2842 = 174	1421 = 175	4462 = 176	688 = 177	3633 = 178	868 = 179	3872 = 180	1024 = 181	4767 + e.k2526 + (e.k4440
4910 = 182	3009 = 183	1301 = 184	4413 = 185	3519 = 186	1406 = 187	3281 = 188	658 = 189	3012 = 190	3868 = 191	2598 = 192	1948 = 193	938 = 194	680 + e.k3943 + (e.k2679
4269 = 195	3895 = 196	49 = 197	3045 = 198	3158 = 199	2804 = 200	1848 = 201	4146 = 202	4109 = 203	439 = 204	1613 = 205	1981 = 206	1538 = 207	3822 + e.k906 + (e.k3856
2579 = 208	1781 = 209	2605 = 210	4371 = 211	2226 = 212	2867 = 213	2505 = 214	2529 = 215	4610 = 216	363 = 217	3058 = 218	241 = 219	2441 = 220	2362 + e.k3872 + (e.k1613
4094 = 221	3438 = 222	2488 = 223	4487 = 224	124 = 225	3271 = 226	455 = 227	520 = 228	94 = 229	4114 = 230	655 = 231	628 = 232	2944 = 233	4525 + e.k3930 + (e.k4766
579 = 234	1469 = 235	3376 = 236	4213 = 237	2580 = 238	4897 = 239	4375 = 240	1033 = 241	4416 = 242	3673 = 243	1801 = 244	4255 = 245	1204 = 246	2488 + e.k1059 + (e.k3601
2873 = 247	1951 = 248	2995 = 249	2491 = 250	4939 = 251	3865 = 252	4770 = 253	3373 = 254	2224 = 255	1869 = 256	1103 = 257	2433 = 258	4550 = 259	945 + e.k658 + (e.k3234`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e24 = fill24(born());
function fill25(e) {`,
      [
        `4084 = 0	3935 = 1	4786 = 2	406 = 3	4563 = 4	1453 = 5	3197 = 6	2500 = 7	188 = 8	190 = 9	3911 = 10	1822 = 11	1562 = 12	4563 + e.k4563 + (e.k874
2873 = 13	2699 = 14	1111 = 15	4242 = 16	3171 = 17	3188 = 18	4590 = 19	512 = 20	2596 = 21	4622 = 22	2066 = 23	1778 = 24	3114 = 25	2596 + e.k3171 + (e.k4900
3174 = 26	195 = 27	2948 = 28	3483 = 29	3396 = 30	2512 = 31	1688 = 32	3504 = 33	3341 = 34	595 = 35	717 = 36	3961 = 37	4266 = 38	595 + e.k3935 + (e.k2443
2347 = 39	4574 = 40	4488 = 41	347 = 42	4844 = 43	3520 = 44	3729 = 45	145 = 46	3697 = 47	4871 = 48	1332 = 49	359 = 50	2215 = 51	359 + e.k3961 + (e.k2872
2323 = 52	1661 = 53	15 = 54	3395 = 55	2755 = 56	3318 = 57	4442 = 58	2005 = 59	4478 = 60	1276 = 61	286 = 62	3854 = 63	2152 = 64	2596 + e.k1332 + (e.k4582
562 = 65	3679 = 66	4606 = 67	4426 = 68	716 = 69	3577 = 70	4895 = 71	2748 = 72	3887 = 73	3605 = 74	1224 = 75	4929 = 76	158 = 77	3729 + e.k188 + (e.k1288
2767 = 78	1572 = 79	3750 = 80	4476 = 81	1630 = 82	3562 = 83	2546 = 84	4220 = 85	2816 = 86	129 = 87	4219 = 88	2001 = 89	2 = 90	3341 + e.k406 + (e.k395
389 = 91	988 = 92	690 = 93	1394 = 94	4154 = 95	2183 = 96	632 = 97	3877 = 98	3474 = 99	1948 = 100	3608 = 101	1041 = 102	3198 = 103	3114 + e.k3198 + (e.k1316
2946 = 104	3970 = 105	4012 = 106	2170 = 107	3426 = 108	1071 = 109	4315 = 110	4733 = 111	1015 = 112	1210 = 113	2475 = 114	2376 = 115	940 = 116	2946 + e.k188 + (e.k760
2459 = 117	1779 = 118	2049 = 119	1971 = 120	3984 = 121	4755 = 122	116 = 123	3269 = 124	2941 = 125	2026 = 126	1372 = 127	23 = 128	775 = 129	4844 + e.k3520 + (e.k2852
3310 = 130	1900 = 131	497 = 132	3885 = 133	3112 = 134	2470 = 135	3275 = 136	2844 = 137	702 = 138	3279 = 139	2712 = 140	3951 = 141	1426 = 142	4755 + e.k3171 + (e.k3272
893 = 143	1067 = 144	4957 = 145	3641 = 146	443 = 147	994 = 148	4217 = 149	1278 = 150	4588 = 151	457 = 152	1946 = 153	4651 = 154	1713 = 155	1394 + e.k3970 + (e.k578
2721 = 156	2573 = 157	425 = 158	1411 = 159	4261 = 160	3309 = 161	4697 = 162	2103 = 163	4197 = 164	4014 = 165	2008 = 166	3610 = 167	2120 = 168	4219 + e.k3970 + (e.k1966
2301 = 169	4263 = 170	1000 = 171	1558 = 172	2799 = 173	220 = 174	325 = 175	1623 = 176	4332 = 177	1938 = 178	3150 = 179	207 = 180	4486 = 181	1071 + e.k3697 + (e.k1947
2228 = 182	611 = 183	2229 = 184	2371 = 185	1789 = 186	833 = 187	111 = 188	1781 = 189	4402 = 190	4542 = 191	272 = 192	2070 = 193	4638 = 194	2721 + e.k3504 + (e.k1822
3715 = 195	2804 = 196	1999 = 197	1787 = 198	1587 = 199	2427 = 200	544 = 201	2206 = 202	500 = 203	587 = 204	4019 = 205	2319 = 206	3975 = 207	1067 + e.k4402 + (e.k4952
2383 = 208	1216 = 209	1377 = 210	1811 = 211	4085 = 212	1435 = 213	240 = 214	77 = 215	786 = 216	2342 = 217	4741 = 218	3094 = 219	2114 = 220	3641 + e.k3112 + (e.k2504
4573 = 221	3403 = 222	4485 = 223	4987 = 224	4832 = 225	2220 = 226	4597 = 227	1677 = 228	1617 = 229	4560 = 230	624 = 231	4541 = 232	322 = 233	3970 + e.k4012 + (e.k123
470 = 234	319 = 235	4107 = 236	4126 = 237	3858 = 238	3416 = 239	3859 = 240	4885 = 241	3532 = 242	1120 = 243	3751 = 244	1927 = 245	268 = 246	2721 + e.k2844 + (e.k3878
4598 = 247	4518 = 248	986 = 249	1751 = 250	3263 = 251	2309 = 252	3645 = 253	2090 = 254	169 = 255	211 = 256	1794 = 257	1665 = 258	2996 = 259	1630 + e.k3279 + (e.k3392`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e25 = fill25(born());
function fill26(e) {`,
      [
        `4583 = 0	738 = 1	601 = 2	426 = 3	4733 = 4	403 = 5	4148 = 6	4781 = 7	4030 = 8	2660 = 9	2274 = 10	4858 = 11	2066 = 12	2660 + e.k4583 + (e.k216
778 = 13	1691 = 14	4615 = 15	1874 = 16	932 = 17	3180 = 18	2459 = 19	3825 = 20	1530 = 21	64 = 22	3874 = 23	1277 = 24	1389 = 25	4148 + e.k3180 + (e.k3626
4769 = 26	1097 = 27	4360 = 28	250 = 29	589 = 30	3479 = 31	732 = 32	499 = 33	3987 = 34	1835 = 35	3598 = 36	2443 = 37	4102 = 38	3479 + e.k403 + (e.k490
4435 = 39	4052 = 40	4878 = 41	3644 = 42	3101 = 43	895 = 44	386 = 45	1620 = 46	995 = 47	901 = 48	4124 = 49	4071 = 50	1150 = 51	4435 + e.k4858 + (e.k4963
1612 = 52	3977 = 53	86 = 54	1523 = 55	3823 = 56	2770 = 57	4923 = 58	2273 = 59	3155 = 60	1424 = 61	3145 = 62	2765 = 63	4201 = 64	3987 + e.k601 + (e.k1826
2989 = 65	4049 = 66	3692 = 67	4641 = 68	3467 = 69	4236 = 70	3995 = 71	897 = 72	2871 = 73	235 = 74	916 = 75	3158 = 76	4076 = 77	2274 + e.k901 + (e.k188
2204 = 78	644 = 79	3123 = 80	4739 = 81	2851 = 82	1450 = 83	4416 = 84	3827 = 85	3246 = 86	3169 = 87	1248 = 88	2089 = 89	4925 = 90	1277 + e.k3977 + (e.k3568
3866 = 91	4432 = 92	4429 = 93	3282 = 94	4565 = 95	4424 = 96	2640 = 97	1958 = 98	527 = 99	657 = 100	3048 = 101	3962 = 102	2541 = 103	2274 + e.k3467 + (e.k4471
4182 = 104	175 = 105	2342 = 106	1227 = 107	3665 = 108	497 = 109	3788 = 110	3920 = 111	4097 = 112	1519 = 113	3484 = 114	4643 = 115	378 = 116	4878 + e.k3169 + (e.k1076
1542 = 117	3822 = 118	2857 = 119	4433 = 120	195 = 121	334 = 122	1664 = 123	4613 = 124	4504 = 125	3804 = 126	2821 = 127	2536 = 128	270 = 129	4583 + e.k3169 + (e.k2473
3103 = 130	4936 = 131	1172 = 132	1678 = 133	2827 = 134	2277 = 135	1211 = 136	1699 = 137	2031 = 138	2885 = 139	3555 = 140	47 = 141	2631 = 142	3822 + e.k3804 + (e.k4771
2487 = 143	3721 = 144	930 = 145	2195 = 146	796 = 147	3331 = 148	2157 = 149	669 = 150	1991 = 151	2112 = 152	1541 = 153	3009 = 154	522 = 155	3825 + e.k4583 + (e.k498
3295 = 156	1549 = 157	976 = 158	625 = 159	3038 = 160	2539 = 161	980 = 162	4755 = 163	3313 = 164	599 = 165	3102 = 166	727 = 167	2017 = 168	1835 + e.k3665 + (e.k3839
4441 = 169	565 = 170	1310 = 171	3954 = 172	2345 = 173	4648 = 174	2055 = 175	1091 = 176	4452 = 177	2093 = 178	3916 = 179	128 = 180	1832 = 181	4441 + e.k2112 + (e.k4418
928 = 182	639 = 183	3423 = 184	815 = 185	4197 = 186	1801 = 187	2091 = 188	4026 = 189	3341 = 190	2719 = 191	2219 = 192	3766 = 193	414 = 194	4026 + e.k3995 + (e.k1809
4973 = 195	2088 = 196	2659 = 197	1556 = 198	434 = 199	3024 = 200	4471 = 201	4740 = 202	2394 = 203	2228 = 204	4634 = 205	2606 = 206	4222 = 207	796 + e.k86 + (e.k1211
1433 = 208	1174 = 209	3499 = 210	3306 = 211	1580 = 212	248 = 213	495 = 214	4442 = 215	3876 = 216	2556 = 217	4663 = 218	4396 = 219	1258 = 220	4936 + e.k3874 + (e.k3792
4458 = 221	448 = 222	2299 = 223	45 = 224	4154 = 225	1655 = 226	1867 = 227	433 = 228	4856 = 229	305 = 230	1406 = 231	4496 = 232	4742 = 233	2273 + e.k1172 + (e.k3238
2437 = 234	2372 = 235	1600 = 236	2149 = 237	4778 = 238	3831 = 239	4343 = 240	2616 = 241	1936 = 242	1044 = 243	2779 = 244	3513 = 245	3603 = 246	235 + e.k4343 + (e.k2943
4987 = 247	2776 = 248	2548 = 249	4870 = 250	4980 = 251	1869 = 252	1732 = 253	2328 = 254	862 = 255	2184 = 256	1529 = 257	121 = 258	4652 = 259	3721 + e.k434 + (e.k3142`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e26 = fill26(born());
function fill27(e) {`,
      [
        `3800 = 0	706 = 1	4920 = 2	3798 = 3	700 = 4	336 = 5	3876 = 6	1963 = 7	611 = 8	1929 = 9	343 = 10	2896 = 11	2725 = 12	3800 + e.k4920 + (e.k3177
2110 = 13	2960 = 14	2719 = 15	1884 = 16	775 = 17	4422 = 18	2576 = 19	330 = 20	3812 = 21	3361 = 22	4739 = 23	875 = 24	2787 = 25	3812 + e.k3800 + (e.k4519
4757 = 26	3978 = 27	3856 = 28	2884 = 29	1495 = 30	1575 = 31	3078 = 32	1193 = 33	930 = 34	1259 = 35	2151 = 36	1983 = 37	3455 = 38	4757 + e.k330 + (e.k1052
3362 = 39	4299 = 40	2330 = 41	3770 = 42	647 = 43	4082 = 44	2999 = 45	1346 = 46	1914 = 47	3079 = 48	3950 = 49	1225 = 50	4003 = 51	3812 + e.k775 + (e.k1447
4213 = 52	106 = 53	944 = 54	78 = 55	4838 = 56	2541 = 57	2243 = 58	2972 = 59	2741 = 60	1243 = 61	4615 = 62	4849 = 63	988 = 64	2787 + e.k3812 + (e.k22
4889 = 65	4234 = 66	1095 = 67	4504 = 68	1327 = 69	3663 = 70	238 = 71	2749 = 72	4386 = 73	2228 = 74	3271 = 75	4050 = 76	8 = 77	4422 + e.k336 + (e.k731
734 = 78	152 = 79	4415 = 80	360 = 81	4334 = 82	3862 = 83	2041 = 84	1730 = 85	1781 = 86	3210 = 87	1811 = 88	1838 = 89	4443 = 90	988 + e.k2576 + (e.k3377
3583 = 91	4401 = 92	982 = 93	2375 = 94	2062 = 95	2224 = 96	832 = 97	2917 = 98	4840 = 99	3370 = 100	1737 = 101	3069 = 102	3084 = 103	2228 + e.k4920 + (e.k487
3009 = 104	2495 = 105	1461 = 106	3251 = 107	4048 = 108	1116 = 109	3563 = 110	80 = 111	4830 = 112	2481 = 113	733 = 114	223 = 115	1240 = 116	2224 + e.k1983 + (e.k1540
4317 = 117	2613 = 118	2385 = 119	3521 = 120	3656 = 121	1476 = 122	346 = 123	4833 = 124	2298 = 125	1720 = 126	2179 = 127	1660 = 128	4211 = 129	1929 + e.k2749 + (e.k4786
765 = 130	4603 = 131	633 = 132	4424 = 133	3116 = 134	3828 = 135	4531 = 136	4380 = 137	2060 = 138	1304 = 139	2241 = 140	1065 = 141	2084 = 142	1225 + e.k3210 + (e.k1184
2908 = 143	3016 = 144	3849 = 145	1277 = 146	2194 = 147	4196 = 148	1912 = 149	2229 = 150	3915 = 151	4005 = 152	2706 = 153	2876 = 154	966 = 155	700 + e.k1193 + (e.k1766
3394 = 156	4500 = 157	2392 = 158	269 = 159	3127 = 160	2087 = 161	27 = 162	4115 = 163	1289 = 164	2941 = 165	2933 = 166	4179 = 167	2400 = 168	3950 + e.k1193 + (e.k1084
4903 = 169	173 = 170	2756 = 171	3324 = 172	1638 = 173	2109 = 174	1015 = 175	85 = 176	2210 = 177	979 = 178	1980 = 179	3606 = 180	4391 = 181	4920 + e.k1495 + (e.k2689
495 = 182	4347 = 183	605 = 184	1102 = 185	399 = 186	4408 = 187	4521 = 188	2651 = 189	2785 = 190	305 = 191	3960 = 192	71 = 193	531 = 194	1660 + e.k1102 + (e.k2500
2852 = 195	1024 = 196	1790 = 197	3164 = 198	3664 = 199	3457 = 200	1973 = 201	1375 = 202	483 = 203	2521 = 204	4650 = 205	4286 = 206	4563 = 207	1346 + e.k1737 + (e.k1540
3677 = 208	4926 = 209	3103 = 210	2144 = 211	1945 = 212	1134 = 213	2098 = 214	4535 = 215	2614 = 216	1352 = 217	1040 = 218	2873 = 219	3139 = 220	2241 + e.k4005 + (e.k1292
650 = 221	1496 = 222	1677 = 223	3646 = 224	4126 = 225	2682 = 226	3395 = 227	2992 = 228	1764 = 229	1588 = 230	3043 = 231	3884 = 232	3852 = 233	3960 + e.k2960 + (e.k1279
2371 = 234	4845 = 235	291 = 236	1223 = 237	3680 = 238	3366 = 239	3538 = 240	2207 = 241	558 = 242	2067 = 243	1290 = 244	4976 = 245	986 = 246	3079 + e.k4504 + (e.k2455
2467 = 247	2479 = 248	4453 = 249	1214 = 250	2897 = 251	1070 = 252	4105 = 253	3773 = 254	1986 = 255	4711 = 256	2016 = 257	24 = 258	2260 = 259	1095 + e.k2576 + (e.k2909`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e27 = fill27(born());
function fill28(e) {`,
      [
        `2890 = 0	3868 = 1	3553 = 2	4536 = 3	3514 = 4	3363 = 5	710 = 6	4297 = 7	2270 = 8	4737 = 9	4861 = 10	2491 = 11	4101 = 12	4101 + e.k2491 + (e.k316
3624 = 13	782 = 14	3237 = 15	2052 = 16	1679 = 17	1587 = 18	3250 = 19	4708 = 20	4646 = 21	4650 = 22	1544 = 23	2560 = 24	2144 = 25	3250 + e.k3363 + (e.k1676
2652 = 26	1311 = 27	2604 = 28	1720 = 29	2778 = 30	4492 = 31	4777 = 32	1743 = 33	3662 = 34	3871 = 35	4639 = 36	2963 = 37	2840 = 38	3871 + e.k4861 + (e.k4466
1172 = 39	3269 = 40	1738 = 41	1033 = 42	1662 = 43	4246 = 44	2561 = 45	1689 = 46	1981 = 47	1687 = 48	3666 = 49	1570 = 50	4211 = 51	1687 + e.k1587 + (e.k3081
2317 = 52	653 = 53	1894 = 54	378 = 55	2861 = 56	2507 = 57	1272 = 58	2759 = 59	2484 = 60	1285 = 61	4051 = 62	2737 = 63	3686 = 64	1689 + e.k1738 + (e.k911
2422 = 65	1348 = 66	846 = 67	2691 = 68	4141 = 69	3056 = 70	1206 = 71	3024 = 72	4544 = 73	76 = 74	1194 = 75	2969 = 76	2998 = 77	378 + e.k4646 + (e.k636
4633 = 78	2278 = 79	2955 = 80	778 = 81	3188 = 82	4376 = 83	640 = 84	245 = 85	4986 = 86	2459 = 87	2952 = 88	4155 = 89	2296 = 90	710 + e.k245 + (e.k3455
1455 = 91	2478 = 92	4114 = 93	7 = 94	959 = 95	4774 = 96	171 = 97	3610 = 98	3843 = 99	1714 = 100	1231 = 101	1579 = 102	3698 = 103	4051 + e.k3237 + (e.k3059
2544 = 104	2600 = 105	1192 = 106	619 = 107	2828 = 108	795 = 109	3140 = 110	548 = 111	135 = 112	2183 = 113	2975 = 114	4493 = 115	2729 = 116	2652 + e.k4155 + (e.k1565
3509 = 117	4345 = 118	3879 = 119	1697 = 120	424 = 121	583 = 122	1388 = 123	1187 = 124	3356 = 125	2425 = 126	2838 = 127	3716 = 128	1134 = 129	1206 + e.k2737 + (e.k3883
4249 = 130	2957 = 131	1216 = 132	4302 = 133	2608 = 134	3289 = 135	3861 = 136	3979 = 137	4668 = 138	1499 = 139	2740 = 140	4735 = 141	1749 = 142	245 + e.k4493 + (e.k4593
1005 = 143	1079 = 144	1691 = 145	1459 = 146	4137 = 147	4504 = 148	1059 = 149	119 = 150	3156 = 151	2525 = 152	2012 = 153	4579 = 154	4932 = 155	3156 + e.k1544 + (e.k3539
4640 = 156	4564 = 157	4730 = 158	4512 = 159	1139 = 160	1151 = 161	4040 = 162	4407 = 163	3193 = 164	4224 = 165	1241 = 166	2240 = 167	274 = 168	2240 + e.k3662 + (e.k4642
4143 = 169	4620 = 170	3975 = 171	1545 = 172	1601 = 173	2642 = 174	4406 = 175	227 = 176	100 = 177	3652 = 178	2468 = 179	1209 = 180	2871 = 181	710 + e.k3624 + (e.k4228
2746 = 182	1669 = 183	1393 = 184	3920 = 185	1392 = 186	2153 = 187	1436 = 188	1283 = 189	1690 = 190	1736 = 191	835 = 192	3378 = 193	1413 = 194	2746 + e.k3024 + (e.k3706
2770 = 195	2841 = 196	1146 = 197	4046 = 198	1458 = 199	455 = 200	3304 = 201	1667 = 202	581 = 203	2431 = 204	365 = 205	3466 = 206	1000 = 207	653 + e.k3237 + (e.k1968
4068 = 208	3842 = 209	1074 = 210	1117 = 211	3548 = 212	4275 = 213	3755 = 214	701 = 215	1599 = 216	1353 = 217	156 = 218	683 = 219	4428 = 220	3861 + e.k4668 + (e.k1539
1680 = 221	3486 = 222	3423 = 223	2881 = 224	3961 = 225	3584 = 226	4907 = 227	2214 = 228	3455 = 229	1902 = 230	4185 = 231	3563 = 232	384 = 233	4650 + e.k2484 + (e.k852
2810 = 234	3517 = 235	4528 = 236	4966 = 237	711 = 238	1091 = 239	2273 = 240	2563 = 241	604 = 242	1868 = 243	499 = 244	3159 = 245	4855 = 246	3871 + e.k3237 + (e.k68
4838 = 247	4487 = 248	2105 = 249	3650 = 250	3425 = 251	4499 = 252	1873 = 253	2704 = 254	2216 = 255	1446 = 256	3732 = 257	4794 = 258	1484 = 259	2975 + e.k3624 + (e.k2543`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e28 = fill28(born());
function fill29(e) {`,
      [
        `982 = 0	980 = 1	3863 = 2	1248 = 3	1098 = 4	3363 = 5	8 = 6	4760 = 7	3954 = 8	4421 = 9	2254 = 10	1723 = 11	2204 = 12	1248 + e.k3863 + (e.k3226
505 = 13	1290 = 14	3620 = 15	4163 = 16	1174 = 17	58 = 18	2395 = 19	105 = 20	3613 = 21	3109 = 22	3653 = 23	4175 = 24	3005 = 25	8 + e.k1098 + (e.k4805
2242 = 26	3867 = 27	3529 = 28	874 = 29	1691 = 30	565 = 31	421 = 32	3178 = 33	3989 = 34	3775 = 35	3004 = 36	1077 = 37	1445 = 38	3529 + e.k3109 + (e.k3169
4831 = 39	1317 = 40	2861 = 41	4955 = 42	1056 = 43	64 = 44	4891 = 45	4494 = 46	1035 = 47	313 = 48	4145 = 49	4905 = 50	714 = 51	2395 + e.k982 + (e.k1554
4615 = 52	4240 = 53	2673 = 54	1688 = 55	4491 = 56	2638 = 57	3339 = 58	2980 = 59	2178 = 60	4849 = 61	2243 = 62	1501 = 63	849 = 64	4491 + e.k3653 + (e.k3347
4556 = 65	2790 = 66	3571 = 67	4514 = 68	2144 = 69	4828 = 70	1623 = 71	900 = 72	4672 = 73	677 = 74	2987 = 75	1130 = 76	169 = 77	3867 + e.k1035 + (e.k3452
1327 = 78	1462 = 79	4094 = 80	2478 = 81	1166 = 82	1169 = 83	4056 = 84	36 = 85	1670 = 86	876 = 87	770 = 88	2646 = 89	1152 = 90	1130 + e.k1462 + (e.k215
4668 = 91	3237 = 92	2945 = 93	4713 = 94	3446 = 95	4719 = 96	1534 = 97	529 = 98	3152 = 99	3441 = 100	3462 = 101	2299 = 102	1794 = 103	3613 + e.k4615 + (e.k4300
220 = 104	2459 = 105	1876 = 106	4588 = 107	3371 = 108	4820 = 109	4403 = 110	4892 = 111	4397 = 112	3138 = 113	3885 = 114	4158 = 115	4348 = 116	3620 + e.k4494 + (e.k3180
2079 = 117	480 = 118	612 = 119	670 = 120	3443 = 121	2785 = 122	4688 = 123	3194 = 124	1707 = 125	1334 = 126	3050 = 127	866 = 128	2405 = 129	3050 + e.k3178 + (e.k2002
3684 = 130	2511 = 131	3019 = 132	1133 = 133	2329 = 134	260 = 135	302 = 136	181 = 137	1249 = 138	4700 = 139	2014 = 140	1734 = 141	4024 = 142	4163 + e.k3867 + (e.k3923
1711 = 143	1563 = 144	3047 = 145	4660 = 146	1324 = 147	4578 = 148	674 = 149	3719 = 150	4717 = 151	1474 = 152	4058 = 153	4606 = 154	2864 = 155	4606 + e.k4240 + (e.k1575
1695 = 156	1915 = 157	442 = 158	287 = 159	3124 = 160	690 = 161	2147 = 162	1593 = 163	1692 = 164	3541 = 165	2324 = 166	2003 = 167	2024 = 168	3050 + e.k1445 + (e.k3086
2328 = 169	2126 = 170	3317 = 171	2453 = 172	2219 = 173	953 = 174	145 = 175	1146 = 176	4790 = 177	422 = 178	2973 = 179	2425 = 180	1362 = 181	3138 + e.k3178 + (e.k3789
3370 = 182	2313 = 183	4821 = 184	403 = 185	4242 = 186	2608 = 187	1093 = 188	3947 = 189	4570 = 190	4922 = 191	743 = 192	3905 = 193	3998 = 194	3050 + e.k866 + (e.k651
1015 = 195	49 = 196	3994 = 197	250 = 198	3468 = 199	4316 = 200	3978 = 201	2211 = 202	1979 = 203	4256 = 204	1633 = 205	2856 = 206	4677 = 207	4820 + e.k3339 + (e.k1960
2759 = 208	1581 = 209	2040 = 210	3652 = 211	1049 = 212	3967 = 213	1416 = 214	1833 = 215	2860 = 216	2249 = 217	2530 = 218	864 = 219	3964 = 220	2299 + e.k3152 + (e.k1112
4201 = 221	1847 = 222	760 = 223	847 = 224	3826 = 225	2585 = 226	2935 = 227	3340 = 228	803 = 229	4964 = 230	591 = 231	460 = 232	4365 = 233	2856 + e.k2453 + (e.k3013
3192 = 234	257 = 235	2974 = 236	4034 = 237	534 = 238	1183 = 239	2006 = 240	1931 = 241	2810 = 242	4080 = 243	3534 = 244	2131 = 245	2865 = 246	2860 + e.k4158 + (e.k579
2167 = 247	894 = 248	3610 = 249	3774 = 250	871 = 251	4832 = 252	2948 = 253	3471 = 254	2594 = 255	3693 = 256	4670 = 257	4552 = 258	468 = 259	3774 + e.k2178 + (e.k2959`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e29 = fill29(born());
function fill30(e) {`,
      [
        `1776 = 0	2768 = 1	3793 = 2	24 = 3	519 = 4	3236 = 5	2486 = 6	1857 = 7	2854 = 8	427 = 9	3698 = 10	3546 = 11	3952 = 12	3236 + e.k2768 + (e.k3018
2977 = 13	3294 = 14	148 = 15	3464 = 16	4971 = 17	3136 = 18	2822 = 19	4897 = 20	1689 = 21	4593 = 22	4164 = 23	3442 = 24	2199 = 25	4593 + e.k2486 + (e.k1741
837 = 26	1205 = 27	4984 = 28	1947 = 29	1197 = 30	4769 = 31	894 = 32	3493 = 33	4487 = 34	2960 = 35	4112 = 36	2913 = 37	1002 = 38	3442 + e.k3952 + (e.k3129
3345 = 39	4215 = 40	753 = 41	909 = 42	4320 = 43	614 = 44	3919 = 45	4872 = 46	294 = 47	4959 = 48	3966 = 49	29 = 50	2632 = 51	1002 + e.k2768 + (e.k557
985 = 52	3733 = 53	3789 = 54	3385 = 55	628 = 56	922 = 57	2910 = 58	3936 = 59	1631 = 60	1417 = 61	667 = 62	3752 = 63	2126 = 64	985 + e.k1002 + (e.k3632
2874 = 65	4712 = 66	1139 = 67	4823 = 68	3207 = 69	3571 = 70	2553 = 71	1028 = 72	4380 = 73	2188 = 74	1849 = 75	1498 = 76	4659 = 77	4712 + e.k2126 + (e.k1947
745 = 78	2612 = 79	4900 = 80	1354 = 81	22 = 82	2753 = 83	3191 = 84	2761 = 85	4994 = 86	962 = 87	2931 = 88	2868 = 89	1803 = 90	837 + e.k4215 + (e.k4249
3490 = 91	3931 = 92	1995 = 93	705 = 94	4540 = 95	2410 = 96	2145 = 97	4978 = 98	1206 = 99	2323 = 100	3525 = 101	2919 = 102	114 = 103	2761 + e.k3207 + (e.k1174
4283 = 104	2431 = 105	3536 = 106	4075 = 107	4355 = 108	3454 = 109	3166 = 110	2079 = 111	1303 = 112	420 = 113	3522 = 114	4943 = 115	2537 = 116	2079 + e.k753 + (e.k4207
901 = 117	2562 = 118	1006 = 119	2005 = 120	3445 = 121	2539 = 122	1923 = 123	4067 = 124	2727 = 125	2650 = 126	2299 = 127	4746 = 128	1059 = 129	1197 + e.k1498 + (e.k1733
2296 = 130	1297 = 131	1814 = 132	957 = 133	4645 = 134	684 = 135	4693 = 136	638 = 137	2147 = 138	1611 = 139	3781 = 140	4650 = 141	4045 = 142	3789 + e.k2753 + (e.k4194
2264 = 143	4713 = 144	2032 = 145	989 = 146	3126 = 147	947 = 148	1395 = 149	406 = 150	447 = 151	3319 = 152	143 = 153	2503 = 154	1270 = 155	901 + e.k4712 + (e.k4340
1644 = 156	3603 = 157	405 = 158	2785 = 159	1186 = 160	2532 = 161	3408 = 162	1772 = 163	4764 = 164	4160 = 165	3732 = 166	3509 = 167	3293 = 168	3733 + e.k3733 + (e.k1783
1860 = 169	1268 = 170	4096 = 171	2797 = 172	4261 = 173	1851 = 174	3926 = 175	1933 = 176	2115 = 177	2003 = 178	970 = 179	4568 = 180	4101 = 181	1206 + e.k3781 + (e.k3316
2282 = 182	3156 = 183	2986 = 184	549 = 185	2911 = 186	1822 = 187	1601 = 188	2276 = 189	2034 = 190	4609 = 191	4188 = 192	3437 = 193	4421 = 194	2126 + e.k1354 + (e.k4035
3848 = 195	364 = 196	3151 = 197	4884 = 198	426 = 199	2957 = 200	4503 = 201	1583 = 202	3273 = 203	1701 = 204	936 = 205	4493 = 206	934 = 207	3156 + e.k3273 + (e.k1911
2379 = 208	513 = 209	4228 = 210	3219 = 211	4305 = 212	1825 = 213	1546 = 214	1108 = 215	1333 = 216	1743 = 217	4533 = 218	1082 = 219	2603 = 220	1803 + e.k2323 + (e.k3301
4545 = 221	1022 = 222	600 = 223	3886 = 224	2683 = 225	3981 = 226	2589 = 227	1970 = 228	452 = 229	4000 = 230	466 = 231	4595 = 232	1443 = 233	1814 + e.k3294 + (e.k4835
1039 = 234	4205 = 235	295 = 236	3556 = 237	4638 = 238	3595 = 239	1919 = 240	2843 = 241	3679 = 242	3336 = 243	830 = 244	3727 = 245	4498 = 246	922 + e.k614 + (e.k4513
2023 = 247	828 = 248	1220 = 249	841 = 250	2169 = 251	4842 = 252	2182 = 253	4642 = 254	1679 = 255	704 = 256	1878 = 257	859 = 258	3090 = 259	4112 + e.k962 + (e.k1874`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e30 = fill30(born());
function fill31(e) {`,
      [
        `3262 = 0	2483 = 1	4756 = 2	3091 = 3	3109 = 4	102 = 5	4252 = 6	4641 = 7	2423 = 8	1761 = 9	1368 = 10	3428 = 11	4171 = 12	3091 + e.k3262 + (e.k3700
4333 = 13	3793 = 14	1843 = 15	4385 = 16	1195 = 17	326 = 18	435 = 19	2274 = 20	244 = 21	1119 = 22	3612 = 23	2451 = 24	3440 = 25	1195 + e.k3428 + (e.k4795
4312 = 26	3486 = 27	2474 = 28	4539 = 29	3111 = 30	1342 = 31	918 = 32	2024 = 33	3934 = 34	1257 = 35	1515 = 36	2792 = 37	3304 = 38	435 + e.k3091 + (e.k448
2919 = 39	2040 = 40	699 = 41	256 = 42	2240 = 43	2969 = 44	2173 = 45	1730 = 46	2594 = 47	2308 = 48	4713 = 49	4972 = 50	1004 = 51	1515 + e.k1004 + (e.k1357
4136 = 52	939 = 53	178 = 54	570 = 55	2366 = 56	2005 = 57	1551 = 58	478 = 59	596 = 60	4929 = 61	344 = 62	4979 = 63	1207 = 64	1119 + e.k3262 + (e.k2381
4798 = 65	869 = 66	3677 = 67	3693 = 68	3800 = 69	825 = 70	599 = 71	2201 = 72	3413 = 73	4044 = 74	575 = 75	3405 = 76	3216 = 77	4312 + e.k1257 + (e.k116
893 = 78	1753 = 79	2833 = 80	137 = 81	716 = 82	235 = 83	839 = 84	2808 = 85	2362 = 86	790 = 87	3479 = 88	1939 = 89	4105 = 90	3934 + e.k435 + (e.k3251
1084 = 91	4172 = 92	1215 = 93	3998 = 94	1225 = 95	4818 = 96	2049 = 97	2666 = 98	2061 = 99	4496 = 100	4292 = 101	2822 = 102	3675 = 103	4333 + e.k4312 + (e.k1841
4994 = 104	4065 = 105	1405 = 106	3758 = 107	1851 = 108	2139 = 109	3331 = 110	3703 = 111	1177 = 112	2573 = 113	1556 = 114	2413 = 115	836 = 116	1215 + e.k2061 + (e.k990
1655 = 117	4681 = 118	4882 = 119	110 = 120	1378 = 121	991 = 122	1732 = 123	927 = 124	1033 = 125	4010 = 126	4281 = 127	3781 = 128	1565 = 129	4065 + e.k4882 + (e.k3144
1919 = 130	1319 = 131	3495 = 132	3196 = 133	4066 = 134	3939 = 135	4190 = 136	753 = 137	160 = 138	4869 = 139	257 = 140	2935 = 141	2946 = 142	4172 + e.k2005 + (e.k4197
4942 = 143	4708 = 144	1976 = 145	2116 = 146	4767 = 147	1656 = 148	2107 = 149	3811 = 150	4204 = 151	3542 = 152	4243 = 153	1786 = 154	767 = 155	2308 + e.k1225 + (e.k1925
1784 = 156	59 = 157	2376 = 158	4783 = 159	4578 = 160	4934 = 161	3399 = 162	4963 = 163	2281 = 164	104 = 165	2203 = 166	3246 = 167	2204 = 168	4171 + e.k4934 + (e.k3055
352 = 169	2910 = 170	4867 = 171	1685 = 172	1074 = 173	8 = 174	3164 = 175	3510 = 176	95 = 177	661 = 178	798 = 179	4815 = 180	1602 = 181	1074 + e.k4756 + (e.k4741
4121 = 182	4701 = 183	3617 = 184	4703 = 185	2225 = 186	1665 = 187	3155 = 188	2950 = 189	4720 = 190	420 = 191	4653 = 192	1355 = 193	260 = 194	939 + e.k4204 + (e.k4285
3809 = 195	1997 = 196	2927 = 197	1560 = 198	2158 = 199	2221 = 200	4742 = 201	931 = 202	2429 = 203	2614 = 204	3202 = 205	3653 = 206	1072 = 207	2024 + e.k3811 + (e.k2963
2212 = 208	1774 = 209	1481 = 210	3320 = 211	3482 = 212	4687 = 213	3354 = 214	3070 = 215	3327 = 216	2289 = 217	984 = 218	516 = 219	4363 = 220	160 + e.k59 + (e.k2894
510 = 221	1838 = 222	4052 = 223	3061 = 224	1281 = 225	1542 = 226	4104 = 227	906 = 228	1466 = 229	3478 = 230	222 = 231	590 = 232	3101 = 233	575 + e.k3440 + (e.k1205
1263 = 234	1989 = 235	254 = 236	1827 = 237	2455 = 238	1231 = 239	4068 = 240	4566 = 241	2774 = 242	390 = 243	2635 = 244	4042 = 245	2984 = 246	3101 + e.k2573 + (e.k4200
1104 = 247	491 = 248	3582 = 249	2494 = 250	2030 = 251	2646 = 252	142 = 253	3317 = 254	4412 = 255	1031 = 256	4299 = 257	4707 = 258	1759 = 259	3440 + e.k4783 + (e.k4179`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e31 = fill31(born());
function fill32(e) {`,
      [
        `4739 = 0	4818 = 1	3242 = 2	3142 = 3	2509 = 4	2694 = 5	4748 = 6	1470 = 7	2205 = 8	4243 = 9	3336 = 10	213 = 11	4816 = 12	4739 + e.k2694 + (e.k2193
15 = 13	616 = 14	3084 = 15	4781 = 16	1915 = 17	3490 = 18	2158 = 19	3542 = 20	899 = 21	779 = 22	1596 = 23	434 = 24	4491 = 25	3542 + e.k779 + (e.k1952
3986 = 26	1955 = 27	113 = 28	3114 = 29	1687 = 30	4090 = 31	3724 = 32	1331 = 33	2481 = 34	1375 = 35	3616 = 36	559 = 37	4658 = 38	1596 + e.k3336 + (e.k2436
17 = 39	72 = 40	4211 = 41	4908 = 42	1499 = 43	2162 = 44	698 = 45	3212 = 46	131 = 47	824 = 48	3976 = 49	4723 = 50	2713 = 51	4658 + e.k3212 + (e.k3734
1032 = 52	3782 = 53	4893 = 54	3268 = 55	3749 = 56	2997 = 57	2735 = 58	3060 = 59	4470 = 60	1483 = 61	1922 = 62	1979 = 63	1520 = 64	2735 + e.k2509 + (e.k2084
2784 = 65	1513 = 66	4049 = 67	31 = 68	3819 = 69	2321 = 70	3351 = 71	4019 = 72	3462 = 73	4234 = 74	833 = 75	915 = 76	106 = 77	3242 + e.k833 + (e.k3755
4399 = 78	2527 = 79	1123 = 80	4 = 81	2560 = 82	3728 = 83	1232 = 84	3539 = 85	2628 = 86	50 = 87	1453 = 88	2278 = 89	2773 = 90	2158 + e.k1331 + (e.k2667
4618 = 91	1893 = 92	4459 = 93	524 = 94	1995 = 95	2769 = 96	3302 = 97	935 = 98	3001 = 99	4203 = 100	2344 = 101	1811 = 102	2957 = 103	3728 + e.k1032 + (e.k1168
2678 = 104	3697 = 105	3998 = 106	2747 = 107	1416 = 108	547 = 109	521 = 110	4274 = 111	387 = 112	2457 = 113	505 = 114	2537 = 115	1388 = 116	106 + e.k3616 + (e.k315
4068 = 117	964 = 118	806 = 119	1771 = 120	312 = 121	801 = 122	1449 = 123	696 = 124	908 = 125	2018 = 126	281 = 127	374 = 128	1785 = 129	2537 + e.k2527 + (e.k447
3167 = 130	1722 = 131	1363 = 132	4189 = 133	1523 = 134	1007 = 135	2887 = 136	1165 = 137	700 = 138	3487 = 139	198 = 140	2489 = 141	1227 = 142	2509 + e.k3986 + (e.k3205
2768 = 143	2920 = 144	1843 = 145	1471 = 146	4021 = 147	596 = 148	4637 = 149	342 = 150	3376 = 151	2992 = 152	343 = 153	3821 = 154	2936 = 155	4739 + e.k4658 + (e.k2055
1672 = 156	1198 = 157	403 = 158	2847 = 159	4407 = 160	1780 = 161	314 = 162	1871 = 163	887 = 164	1203 = 165	3935 = 166	3499 = 167	1607 = 168	3142 + e.k2527 + (e.k3373
2170 = 169	409 = 170	4654 = 171	2405 = 172	4058 = 173	2853 = 174	2000 = 175	3281 = 176	2944 = 177	2774 = 178	4036 = 179	3735 = 180	4257 = 181	1232 + e.k409 + (e.k624
4014 = 182	1912 = 183	1370 = 184	3900 = 185	2459 = 186	2545 = 187	4091 = 188	600 = 189	4370 = 190	2453 = 191	661 = 192	3440 = 193	3207 = 194	2321 + e.k4908 + (e.k1772
3045 = 195	2976 = 196	2330 = 197	414 = 198	2726 = 199	4826 = 200	695 = 201	1790 = 202	4109 = 203	2092 = 204	3817 = 205	399 = 206	850 = 207	1370 + e.k4014 + (e.k326
4710 = 208	569 = 209	1610 = 210	4121 = 211	2013 = 212	4460 = 213	3685 = 214	3070 = 215	580 = 216	2615 = 217	4684 = 218	920 = 219	1983 = 220	2992 + e.k2459 + (e.k3045
421 = 221	261 = 222	2526 = 223	2505 = 224	4917 = 225	2095 = 226	1168 = 227	59 = 228	767 = 229	3622 = 230	1104 = 231	551 = 232	3676 = 233	4019 + e.k3539 + (e.k3634
3310 = 234	2312 = 235	1319 = 236	4336 = 237	4178 = 238	3159 = 239	4237 = 240	459 = 241	3975 = 242	3408 = 243	3792 = 244	3881 = 245	60 = 246	2678 + e.k4068 + (e.k2791
3352 = 247	3752 = 248	2709 = 249	268 = 250	787 = 251	1927 = 252	4383 = 253	3675 = 254	4551 = 255	273 = 256	3839 = 257	4286 = 258	4228 = 259	698 + e.k3352 + (e.k4667`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e32 = fill32(born());
function fill33(e) {`,
      [
        `4570 = 0	889 = 1	3483 = 2	3839 = 3	1720 = 4	220 = 5	2191 = 6	380 = 7	3148 = 8	1113 = 9	3462 = 10	3743 = 11	4360 = 12	380 + e.k3839 + (e.k1932
444 = 13	728 = 14	3346 = 15	3418 = 16	2773 = 17	2967 = 18	4936 = 19	3527 = 20	643 = 21	3333 = 22	4427 = 23	4678 = 24	3782 = 25	3743 + e.k3333 + (e.k3089
3167 = 26	1577 = 27	586 = 28	3697 = 29	2597 = 30	968 = 31	658 = 32	2412 = 33	2559 = 34	77 = 35	1993 = 36	4004 = 37	1730 = 38	4678 + e.k4004 + (e.k3475
1539 = 39	1230 = 40	3264 = 41	243 = 42	4225 = 43	3093 = 44	2206 = 45	2918 = 46	2891 = 47	4387 = 48	3031 = 49	923 = 50	222 = 51	2597 + e.k2891 + (e.k1058
3482 = 52	3937 = 53	4902 = 54	842 = 55	2218 = 56	4207 = 57	2335 = 58	1605 = 59	609 = 60	2901 = 61	3413 = 62	641 = 63	1299 = 64	4225 + e.k641 + (e.k1206
1651 = 65	4111 = 66	555 = 67	60 = 68	4912 = 69	2798 = 70	1530 = 71	2764 = 72	1341 = 73	1461 = 74	4545 = 75	3734 = 76	4151 = 77	4387 + e.k2798 + (e.k4008
2030 = 78	407 = 79	4883 = 80	4192 = 81	1513 = 82	4181 = 83	3950 = 84	2732 = 85	2006 = 86	3284 = 87	1898 = 88	3708 = 89	2129 = 90	60 + e.k2335 + (e.k2818
4354 = 91	4332 = 92	3344 = 93	4054 = 94	1516 = 95	631 = 96	182 = 97	3236 = 98	1329 = 99	4226 = 100	2070 = 101	4611 = 102	884 = 103	3264 + e.k4902 + (e.k3249
2771 = 104	2007 = 105	4432 = 106	2271 = 107	664 = 108	2493 = 109	1140 = 110	2674 = 111	1138 = 112	4457 = 113	2841 = 114	3640 = 115	4526 = 116	3346 + e.k1898 + (e.k4952
3686 = 117	737 = 118	3760 = 119	413 = 120	1926 = 121	639 = 122	3403 = 123	3618 = 124	3458 = 125	2182 = 126	995 = 127	1732 = 128	292 = 129	2732 + e.k2182 + (e.k4205
368 = 130	463 = 131	1526 = 132	2118 = 133	4299 = 134	4464 = 135	3453 = 136	1037 = 137	982 = 138	1741 = 139	211 = 140	2156 = 141	4024 = 142	4912 + e.k2335 + (e.k735
1702 = 143	4758 = 144	3159 = 145	2117 = 146	1242 = 147	2105 = 148	524 = 149	1693 = 150	2413 = 151	1016 = 152	4932 = 153	1413 = 154	2385 = 155	2674 + e.k4464 + (e.k2904
2736 = 156	3318 = 157	2055 = 158	4724 = 159	4831 = 160	2345 = 161	4763 = 162	4614 = 163	1145 = 164	3021 = 165	929 = 166	671 = 167	315 = 168	77 + e.k2070 + (e.k1614
4116 = 169	3709 = 170	3121 = 171	1550 = 172	3572 = 173	1902 = 174	3090 = 175	4099 = 176	1742 = 177	3595 = 178	3826 = 179	254 = 180	2223 = 181	2732 + e.k3743 + (e.k4371
4267 = 182	1759 = 183	813 = 184	3919 = 185	3652 = 186	2845 = 187	3976 = 188	1747 = 189	115 = 190	2419 = 191	1008 = 192	1207 = 193	3960 = 194	3937 + e.k463 + (e.k2401
4072 = 195	4935 = 196	4393 = 197	464 = 198	4019 = 199	848 = 200	1756 = 201	3745 = 202	1758 = 203	1675 = 204	3549 = 205	1777 = 206	4890 = 207	3284 + e.k3453 + (e.k422
3512 = 208	1062 = 209	867 = 210	2014 = 211	4029 = 212	3054 = 213	3553 = 214	1877 = 215	811 = 216	2408 = 217	4104 = 218	3855 = 219	57 = 220	4678 + e.k1758 + (e.k4315
1352 = 221	3356 = 222	2881 = 223	4114 = 224	1527 = 225	2969 = 226	459 = 227	2900 = 228	996 = 229	601 = 230	1915 = 231	654 = 232	3536 = 233	3782 + e.k3483 + (e.k3560
83 = 234	4682 = 235	3721 = 236	2775 = 237	2526 = 238	335 = 239	4895 = 240	4485 = 241	565 = 242	4079 = 243	2646 = 244	3510 = 245	283 = 246	1741 + e.k3462 + (e.k3209
2330 = 247	563 = 248	3733 = 249	2692 = 250	33 = 251	3917 = 252	2702 = 253	809 = 254	2164 = 255	647 = 256	199 = 257	4973 = 258	4641 = 259	3760 + e.k4526 + (e.k3738`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e33 = fill33(born());
function fill34(e) {`,
      [
        `1662 = 0	95 = 1	3466 = 2	873 = 3	1674 = 4	1461 = 5	3171 = 6	2513 = 7	3863 = 8	857 = 9	272 = 10	617 = 11	3321 = 12	1674 + e.k873 + (e.k3014
2815 = 13	4647 = 14	1475 = 15	4304 = 16	3053 = 17	3769 = 18	4496 = 19	3893 = 20	3843 = 21	1117 = 22	3220 = 23	2927 = 24	3948 = 25	3321 + e.k1662 + (e.k4710
4121 = 26	3792 = 27	1294 = 28	888 = 29	4343 = 30	3969 = 31	2596 = 32	2758 = 33	199 = 34	4882 = 35	655 = 36	1071 = 37	592 = 38	1461 + e.k4496 + (e.k3751
4800 = 39	3011 = 40	2631 = 41	1346 = 42	4660 = 43	690 = 44	4207 = 45	901 = 46	3179 = 47	1051 = 48	2372 = 49	2042 = 50	3883 = 51	4343 + e.k2631 + (e.k1507
3223 = 52	3156 = 53	4422 = 54	1357 = 55	1647 = 56	1551 = 57	3643 = 58	1589 = 59	2074 = 60	4348 = 61	4170 = 62	1825 = 63	4123 = 64	4123 + e.k3843 + (e.k4229
42 = 65	4146 = 66	3375 = 67	1354 = 68	4173 = 69	602 = 70	3481 = 71	3606 = 72	753 = 73	620 = 74	895 = 75	4460 = 76	1402 = 77	4660 + e.k1294 + (e.k1625
367 = 78	4126 = 79	902 = 80	4288 = 81	1748 = 82	2608 = 83	3798 = 84	2254 = 85	4092 = 86	2957 = 87	4255 = 88	2044 = 89	4042 = 90	3179 + e.k690 + (e.k1842
1806 = 91	3983 = 92	1801 = 93	2281 = 94	687 = 95	1915 = 96	1101 = 97	1846 = 98	4151 = 99	3766 = 100	2078 = 101	2036 = 102	2216 = 103	655 + e.k2372 + (e.k2634
574 = 104	1973 = 105	524 = 106	3756 = 107	2448 = 108	4947 = 109	1258 = 110	3470 = 111	4475 = 112	4840 = 113	845 = 114	2321 = 115	2646 = 116	2957 + e.k1846 + (e.k4019
3099 = 117	2801 = 118	811 = 119	491 = 120	3363 = 121	2360 = 122	4439 = 123	1614 = 124	4554 = 125	1440 = 126	4139 = 127	2076 = 128	207 = 129	3099 + e.k3893 + (e.k2530
2030 = 130	4560 = 131	3445 = 132	4697 = 133	1740 = 134	4892 = 135	1638 = 136	3629 = 137	2809 = 138	960 = 139	3490 = 140	2326 = 141	3770 = 142	690 + e.k2074 + (e.k320
2587 = 143	2083 = 144	1356 = 145	4201 = 146	2062 = 147	2585 = 148	1926 = 149	3640 = 150	135 = 151	2359 = 152	4112 = 153	7 = 154	714 = 155	3792 + e.k3321 + (e.k2126
1094 = 156	175 = 157	2977 = 158	1802 = 159	3285 = 160	3380 = 161	154 = 162	4987 = 163	1918 = 164	2827 = 165	2569 = 166	426 = 167	365 = 168	1356 + e.k4496 + (e.k3681
3096 = 169	1734 = 170	114 = 171	1133 = 172	725 = 173	509 = 174	3743 = 175	691 = 176	2528 = 177	3961 = 178	1487 = 179	3401 = 180	466 = 181	1806 + e.k960 + (e.k770
2819 = 182	2802 = 183	2052 = 184	567 = 185	1673 = 186	515 = 187	1512 = 188	1594 = 189	475 = 190	1957 = 191	1115 = 192	2662 = 193	3563 = 194	1918 + e.k3743 + (e.k12
3483 = 195	716 = 196	1931 = 197	1865 = 198	1408 = 199	2116 = 200	1833 = 201	4143 = 202	357 = 203	1178 = 204	3617 = 205	3666 = 206	3125 = 207	4947 + e.k1740 + (e.k2975
4752 = 208	4190 = 209	139 = 210	459 = 211	4358 = 212	1775 = 213	4235 = 214	210 = 215	93 = 216	2705 = 217	3603 = 218	2392 = 219	982 = 220	3053 + e.k4697 + (e.k2443
366 = 221	3506 = 222	856 = 223	4703 = 224	2965 = 225	2730 = 226	2130 = 227	2868 = 228	2640 = 229	4004 = 230	4776 = 231	4285 = 232	480 = 233	2585 + e.k687 + (e.k1116
2012 = 234	975 = 235	1796 = 236	1140 = 237	3314 = 238	395 = 239	1233 = 240	2542 = 241	2020 = 242	3991 = 243	4226 = 244	2256 = 245	3845 = 246	1748 + e.k3099 + (e.k4108
4548 = 247	1490 = 248	2559 = 249	1531 = 250	133 = 251	1595 = 252	4382 = 253	1215 = 254	172 = 255	3816 = 256	110 = 257	1666 = 258	393 = 259	2074 + e.k4201 + (e.k3054`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e34 = fill34(born());
function fill35(e) {`,
      [
        `4479 = 0	4107 = 1	1400 = 2	4248 = 3	2791 = 4	2539 = 5	2719 = 6	3901 = 7	599 = 8	2836 = 9	171 = 10	4830 = 11	67 = 12	599 + e.k4248 + (e.k444
843 = 13	2457 = 14	671 = 15	3303 = 16	2047 = 17	1924 = 18	2796 = 19	1040 = 20	2365 = 21	3686 = 22	3973 = 23	2231 = 24	2472 = 25	171 + e.k4107 + (e.k884
1276 = 26	622 = 27	1833 = 28	2822 = 29	193 = 30	853 = 31	1420 = 32	1443 = 33	2501 = 34	3723 = 35	2516 = 36	4606 = 37	770 = 38	1400 + e.k1420 + (e.k3021
3450 = 39	4942 = 40	2775 = 41	4461 = 42	3135 = 43	588 = 44	4829 = 45	3362 = 46	2464 = 47	856 = 48	1052 = 49	375 = 50	3041 = 51	3041 + e.k2047 + (e.k4801
1245 = 52	4590 = 53	4775 = 54	2660 = 55	4752 = 56	4159 = 57	3103 = 58	3226 = 59	2570 = 60	3272 = 61	3601 = 62	1752 = 63	4681 = 64	67 + e.k4107 + (e.k1654
928 = 65	234 = 66	3672 = 67	4537 = 68	4646 = 69	3372 = 70	621 = 71	1995 = 72	3835 = 73	2923 = 74	1496 = 75	872 = 76	3115 = 77	2796 + e.k872 + (e.k4389
1685 = 78	133 = 79	286 = 80	3027 = 81	2383 = 82	3622 = 83	1121 = 84	2918 = 85	247 = 86	3974 = 87	432 = 88	839 = 89	1615 = 90	133 + e.k3974 + (e.k2938
1782 = 91	2261 = 92	781 = 93	4028 = 94	2524 = 95	937 = 96	1659 = 97	1292 = 98	1057 = 99	4759 = 100	3076 = 101	1166 = 102	1893 = 103	1995 + e.k432 + (e.k2078
4200 = 104	1148 = 105	2304 = 106	2476 = 107	3510 = 108	2072 = 109	746 = 110	662 = 111	2115 = 112	3374 = 113	21 = 114	1770 = 115	461 = 116	3835 + e.k171 + (e.k2898
4896 = 117	838 = 118	1862 = 119	3087 = 120	1658 = 121	3646 = 122	3057 = 123	2746 = 124	1362 = 125	2528 = 126	3123 = 127	3631 = 128	4208 = 129	1615 + e.k286 + (e.k1207
2161 = 130	3539 = 131	2761 = 132	3858 = 133	4753 = 134	4477 = 135	4074 = 136	648 = 137	796 = 138	817 = 139	4523 = 140	1015 = 141	1382 = 142	796 + e.k1658 + (e.k4956
304 = 143	2680 = 144	2934 = 145	3889 = 146	961 = 147	966 = 148	4175 = 149	4370 = 150	4204 = 151	2417 = 152	713 = 153	2530 = 154	4714 = 155	4248 + e.k2918 + (e.k1808
176 = 156	3070 = 157	3680 = 158	4184 = 159	4973 = 160	1687 = 161	4678 = 162	2209 = 163	3826 = 164	1242 = 165	2503 = 166	2714 = 167	598 = 168	598 + e.k4646 + (e.k2839
2553 = 169	3732 = 170	4562 = 171	360 = 172	3064 = 173	297 = 174	828 = 175	2642 = 176	3886 = 177	2521 = 178	4797 = 179	1453 = 180	1875 = 181	4752 + e.k286 + (e.k1631
2876 = 182	1131 = 183	2006 = 184	3756 = 185	1027 = 186	1612 = 187	1170 = 188	4467 = 189	727 = 190	1721 = 191	4276 = 192	591 = 193	3724 = 194	234 + e.k843 + (e.k3742
2183 = 195	4155 = 196	4580 = 197	43 = 198	1097 = 199	2469 = 200	4119 = 201	1684 = 202	4229 = 203	2192 = 204	2895 = 205	4321 = 206	1772 = 207	2209 + e.k4461 + (e.k397
2176 = 208	2188 = 209	3318 = 210	4039 = 211	1841 = 212	1060 = 213	619 = 214	2910 = 215	4706 = 216	2525 = 217	2005 = 218	266 = 219	4113 = 220	3858 + e.k1400 + (e.k4177
4302 = 221	2195 = 222	717 = 223	992 = 224	1906 = 225	3157 = 226	1452 = 227	2725 = 228	1079 = 229	2731 = 230	2555 = 231	4136 = 232	68 = 233	4759 + e.k2176 + (e.k1074
3979 = 234	4926 = 235	3170 = 236	4493 = 237	1506 = 238	1173 = 239	4887 = 240	4137 = 241	4277 = 242	4485 = 243	1493 = 244	4098 = 245	4481 = 246	1684 + e.k2680 + (e.k17
890 = 247	2733 = 248	1899 = 249	1256 = 250	2734 = 251	1946 = 252	1274 = 253	583 = 254	4419 = 255	3694 = 256	293 = 257	2748 = 258	181 = 259	3835 + e.k3858 + (e.k1414`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e35 = fill35(born());
function fill36(e) {`,
      [
        `1824 = 0	3762 = 1	1370 = 2	3608 = 3	1176 = 4	384 = 5	167 = 6	2472 = 7	3397 = 8	3531 = 9	1047 = 10	1040 = 11	4170 = 12	1824 + e.k384 + (e.k4404
3544 = 13	2371 = 14	1390 = 15	3751 = 16	1423 = 17	287 = 18	3518 = 19	295 = 20	2493 = 21	3295 = 22	3552 = 23	1620 = 24	4881 = 25	3608 + e.k3295 + (e.k4981
2511 = 26	2588 = 27	364 = 28	723 = 29	3037 = 30	47 = 31	3887 = 32	1328 = 33	3658 = 34	1397 = 35	453 = 36	1544 = 37	2712 = 38	723 + e.k1620 + (e.k371
757 = 39	3871 = 40	3149 = 41	1496 = 42	113 = 43	3681 = 44	1467 = 45	334 = 46	4761 = 47	4103 = 48	2017 = 49	2975 = 50	1419 = 51	167 + e.k723 + (e.k222
4679 = 52	3418 = 53	1653 = 54	2838 = 55	4335 = 56	728 = 57	1240 = 58	3318 = 59	4753 = 60	2576 = 61	4504 = 62	1448 = 63	4112 = 64	3544 + e.k3658 + (e.k4745
4698 = 65	2809 = 66	4957 = 67	3382 = 68	1839 = 69	2049 = 70	2283 = 71	4604 = 72	1515 = 73	2130 = 74	1693 = 75	2509 = 76	1064 = 77	2371 + e.k728 + (e.k2893
3456 = 78	1065 = 79	2398 = 80	4525 = 81	2688 = 82	800 = 83	1994 = 84	3594 = 85	2718 = 86	1997 = 87	4386 = 88	1035 = 89	3714 = 90	2509 + e.k4957 + (e.k3273
919 = 91	4431 = 92	4082 = 93	3107 = 94	1312 = 95	4176 = 96	3851 = 97	3411 = 98	3797 = 99	3736 = 100	1502 = 101	1078 = 102	4977 = 103	3714 + e.k3456 + (e.k1325
2459 = 104	2154 = 105	2250 = 106	3053 = 107	4818 = 108	2364 = 109	1481 = 110	2727 = 111	4944 = 112	1341 = 113	1033 = 114	2143 = 115	1438 = 116	4753 + e.k4818 + (e.k743
995 = 117	1163 = 118	2524 = 119	3230 = 120	3706 = 121	700 = 122	4445 = 123	1618 = 124	4264 = 125	4692 = 126	1542 = 127	3711 = 128	4390 = 129	4818 + e.k2524 + (e.k239
2242 = 130	1949 = 131	1779 = 132	4048 = 133	910 = 134	2427 = 135	1578 = 136	405 = 137	1058 = 138	4699 = 139	3663 = 140	3203 = 141	3501 = 142	4170 + e.k1065 + (e.k2211
3872 = 143	1441 = 144	3208 = 145	2262 = 146	2139 = 147	4450 = 148	1758 = 149	2775 = 150	91 = 151	4658 = 152	2694 = 153	3468 = 154	2977 = 155	2250 + e.k2371 + (e.k4900
3803 = 156	174 = 157	690 = 158	4217 = 159	1621 = 160	2256 = 161	610 = 162	772 = 163	4180 = 164	3505 = 165	423 = 166	4292 = 167	4742 = 168	3456 + e.k1058 + (e.k341
933 = 169	1278 = 170	2508 = 171	2093 = 172	3428 = 173	2099 = 174	4579 = 175	3218 = 176	2697 = 177	4899 = 178	1187 = 179	1933 = 180	4883 = 181	2493 + e.k3295 + (e.k1519
4538 = 182	111 = 183	855 = 184	982 = 185	458 = 186	3502 = 187	4762 = 188	3004 = 189	2269 = 190	4474 = 191	27 = 192	2052 = 193	1477 = 194	1040 + e.k1278 + (e.k912
4318 = 195	2796 = 196	49 = 197	3387 = 198	2000 = 199	252 = 200	2636 = 201	3240 = 202	966 = 203	1134 = 204	2548 = 205	4069 = 206	218 = 207	3053 + e.k2511 + (e.k1691
4859 = 208	3807 = 209	1741 = 210	3553 = 211	2909 = 212	3630 = 213	4505 = 214	1957 = 215	1845 = 216	1606 = 217	3962 = 218	3484 = 219	609 = 220	1278 + e.k1187 + (e.k3272
2534 = 221	3535 = 222	2356 = 223	428 = 224	3931 = 225	3432 = 226	1048 = 227	1399 = 228	2458 = 229	907 = 230	2272 = 231	4534 = 232	1421 = 233	2775 + e.k1845 + (e.k492
3661 = 234	395 = 235	3839 = 236	2919 = 237	2861 = 238	2479 = 239	1530 = 240	3741 = 241	681 = 242	260 = 243	286 = 244	4654 = 245	3926 = 246	1621 + e.k2588 + (e.k1166
228 = 247	3194 = 248	4661 = 249	1590 = 250	1804 = 251	1258 = 252	3561 = 253	2210 = 254	2305 = 255	127 = 256	133 = 257	2473 = 258	2773 = 259	1496 + e.k3658 + (e.k3667`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e36 = fill36(born());
function fill37(e) {`,
      [
        `1038 = 0	1373 = 1	396 = 2	1332 = 3	3720 = 4	2203 = 5	2468 = 6	204 = 7	3277 = 8	4603 = 9	2845 = 10	2127 = 11	964 = 12	396 + e.k2203 + (e.k2207
562 = 13	3048 = 14	2549 = 15	945 = 16	1828 = 17	1577 = 18	4482 = 19	738 = 20	44 = 21	1349 = 22	3568 = 23	817 = 24	3093 = 25	964 + e.k3568 + (e.k4879
1583 = 26	2835 = 27	2900 = 28	3577 = 29	1170 = 30	501 = 31	627 = 32	4140 = 33	1163 = 34	1606 = 35	2674 = 36	3410 = 37	1193 = 38	4482 + e.k2674 + (e.k2755
1195 = 39	4759 = 40	1241 = 41	4637 = 42	2280 = 43	3581 = 44	1765 = 45	4362 = 46	1698 = 47	4666 = 48	4828 = 49	1152 = 50	395 = 51	2845 + e.k1583 + (e.k544
4081 = 52	386 = 53	3327 = 54	2522 = 55	1735 = 56	2989 = 57	3211 = 58	4091 = 59	135 = 60	263 = 61	599 = 62	3612 = 63	578 = 64	396 + e.k599 + (e.k1876
636 = 65	3769 = 66	904 = 67	2664 = 68	914 = 69	2518 = 70	2025 = 71	3557 = 72	4948 = 73	2154 = 74	3906 = 75	1816 = 76	710 = 77	4140 + e.k636 + (e.k140
1601 = 78	3420 = 79	659 = 80	3374 = 81	1857 = 82	3076 = 83	3589 = 84	2784 = 85	2925 = 86	1776 = 87	1804 = 88	4317 = 89	2676 = 90	710 + e.k2025 + (e.k1171
1290 = 91	906 = 92	1117 = 93	884 = 94	2918 = 95	1293 = 96	2976 = 97	1116 = 98	387 = 99	3709 = 100	1175 = 101	4973 = 102	1742 = 103	3612 + e.k1804 + (e.k3417
181 = 104	3997 = 105	57 = 106	2559 = 107	4413 = 108	6 = 109	1642 = 110	576 = 111	4819 = 112	20 = 113	3945 = 114	36 = 115	1841 = 116	4362 + e.k4666 + (e.k4080
1690 = 117	3178 = 118	3080 = 119	3437 = 120	220 = 121	2172 = 122	1501 = 123	3954 = 124	3606 = 125	1995 = 126	342 = 127	1739 = 128	3882 = 129	2835 + e.k3906 + (e.k1076
4563 = 130	3429 = 131	217 = 132	3458 = 133	353 = 134	485 = 135	4321 = 136	4857 = 137	219 = 138	925 = 139	2430 = 140	1465 = 141	1969 = 142	1193 + e.k396 + (e.k3510
3369 = 143	1470 = 144	265 = 145	4632 = 146	2509 = 147	4052 = 148	3748 = 149	1729 = 150	4769 = 151	4910 = 152	4252 = 153	2392 = 154	4585 = 155	2835 + e.k1729 + (e.k1885
3832 = 156	3484 = 157	1961 = 158	2253 = 159	4506 = 160	4939 = 161	2498 = 162	1625 = 163	3145 = 164	2387 = 165	21 = 166	195 = 167	4028 = 168	3954 + e.k2468 + (e.k1903
3436 = 169	4193 = 170	3733 = 171	2715 = 172	824 = 173	3236 = 174	3324 = 175	3038 = 176	2041 = 177	2970 = 178	12 = 179	848 = 180	939 = 181	395 + e.k265 + (e.k4384
3535 = 182	3044 = 183	4630 = 184	1650 = 185	742 = 186	315 = 187	704 = 188	4072 = 189	1111 = 190	3597 = 191	838 = 192	2174 = 193	1218 = 194	3145 + e.k1193 + (e.k773
492 = 195	1094 = 196	564 = 197	934 = 198	3635 = 199	149 = 200	2005 = 201	2563 = 202	2847 = 203	655 = 204	4184 = 205	2305 = 206	1105 = 207	1816 + e.k2559 + (e.k730
3358 = 208	1060 = 209	3388 = 210	1948 = 211	4480 = 212	3129 = 213	1258 = 214	1858 = 215	3088 = 216	4027 = 217	4894 = 218	897 = 219	3322 = 220	3178 + e.k20 + (e.k2312
2322 = 221	2367 = 222	948 = 223	717 = 224	3544 = 225	1251 = 226	557 = 227	730 = 228	2597 = 229	1394 = 230	2500 = 231	1926 = 232	2362 = 233	353 + e.k1394 + (e.k160
3152 = 234	1194 = 235	1736 = 236	3919 = 237	3380 = 238	2237 = 239	4313 = 240	1987 = 241	433 = 242	2001 = 243	835 = 244	4373 = 245	1303 = 246	1736 + e.k3577 + (e.k2204
1744 = 247	4333 = 248	2659 = 249	3884 = 250	1494 = 251	1843 = 252	368 = 253	2665 = 254	336 = 255	1433 = 256	1461 = 257	4690 = 258	2716 = 259	1349 + e.k4091 + (e.k1811`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e37 = fill37(born());
function fill38(e) {`,
      [
        `4182 = 0	2855 = 1	1799 = 2	1101 = 3	1428 = 4	1751 = 5	2940 = 6	3094 = 7	2067 = 8	2157 = 9	3842 = 10	1902 = 11	330 = 12	2855 + e.k1799 + (e.k485
607 = 13	335 = 14	489 = 15	1174 = 16	1996 = 17	2800 = 18	2190 = 19	4535 = 20	1968 = 21	2992 = 22	219 = 23	4073 = 24	4897 = 25	1751 + e.k1428 + (e.k2769
411 = 26	3419 = 27	354 = 28	895 = 29	4195 = 30	4962 = 31	3837 = 32	1933 = 33	2963 = 34	2858 = 35	4392 = 36	3799 = 37	614 = 38	2855 + e.k2963 + (e.k4210
1419 = 39	941 = 40	173 = 41	1173 = 42	1017 = 43	1229 = 44	1048 = 45	3140 = 46	1709 = 47	4883 = 48	4751 = 49	1627 = 50	3342 = 51	2992 + e.k2963 + (e.k920
4747 = 52	3921 = 53	1032 = 54	2384 = 55	1150 = 56	4774 = 57	2327 = 58	1866 = 59	2659 = 60	1159 = 61	3592 = 62	1423 = 63	961 = 64	961 + e.k2855 + (e.k125
398 = 65	3570 = 66	946 = 67	3995 = 68	2064 = 69	3588 = 70	4934 = 71	392 = 72	3700 = 73	2683 = 74	2529 = 75	4458 = 76	296 = 77	3419 + e.k2327 + (e.k298
1477 = 78	111 = 79	3223 = 80	503 = 81	2726 = 82	1984 = 83	3412 = 84	2984 = 85	4202 = 86	1012 = 87	400 = 88	719 = 89	1067 = 90	607 + e.k296 + (e.k1652
1603 = 91	263 = 92	1290 = 93	883 = 94	4493 = 95	3379 = 96	1134 = 97	4913 = 98	4538 = 99	3687 = 100	4715 = 101	507 = 102	1033 = 103	3094 + e.k4202 + (e.k4661
250 = 104	875 = 105	3178 = 106	2337 = 107	2009 = 108	4463 = 109	3101 = 110	2787 = 111	4959 = 112	3809 = 113	727 = 114	1822 = 115	3373 = 116	2992 + e.k4182 + (e.k4556
3993 = 117	3445 = 118	1210 = 119	1556 = 120	603 = 121	2819 = 122	2499 = 123	2849 = 124	1905 = 125	2412 = 126	339 = 127	2916 = 128	2967 = 129	398 + e.k4195 + (e.k3859
1631 = 130	4885 = 131	4405 = 132	1947 = 133	1590 = 134	3791 = 135	473 = 136	1776 = 137	4835 = 138	288 = 139	805 = 140	3721 = 141	3016 = 142	603 + e.k4747 + (e.k2483
3525 = 143	2974 = 144	1267 = 145	143 = 146	2765 = 147	859 = 148	2602 = 149	295 = 150	1168 = 151	141 = 152	4585 = 153	2462 = 154	4012 = 155	4202 + e.k2009 + (e.k51
2382 = 156	1613 = 157	573 = 158	4948 = 159	4980 = 160	1232 = 161	1147 = 162	923 = 163	3792 = 164	3400 = 165	3030 = 166	3878 = 167	1120 = 168	1428 + e.k4538 + (e.k1161
2689 = 169	77 = 170	4181 = 171	455 = 172	618 = 173	293 = 174	1893 = 175	21 = 176	2959 = 177	2549 = 178	2134 = 179	2393 = 180	585 = 181	2659 + e.k1590 + (e.k1897
3901 = 182	3847 = 183	3736 = 184	4107 = 185	225 = 186	2534 = 187	336 = 188	756 = 189	2982 = 190	4666 = 191	3310 = 192	4414 = 193	1155 = 194	883 + e.k3847 + (e.k4786
1313 = 195	3668 = 196	4604 = 197	2531 = 198	537 = 199	3409 = 200	3845 = 201	2917 = 202	257 = 203	2307 = 204	1796 = 205	4094 = 206	2948 = 207	4715 + e.k173 + (e.k3517
4596 = 208	4832 = 209	3560 = 210	1623 = 211	2437 = 212	2110 = 213	2359 = 214	3559 = 215	2333 = 216	3232 = 217	937 = 218	4857 = 219	1412 = 220	3588 + e.k923 + (e.k3255
3347 = 221	4985 = 222	4703 = 223	3816 = 224	4829 = 225	3469 = 226	4254 = 227	404 = 228	464 = 229	524 = 230	4224 = 231	4725 = 232	3155 = 233	141 + e.k537 + (e.k4749
3766 = 234	1347 = 235	1089 = 236	1344 = 237	3957 = 238	3191 = 239	3116 = 240	3904 = 241	2165 = 242	1206 = 243	1140 = 244	1130 = 245	1782 = 246	4493 + e.k3791 + (e.k1185
919 = 247	3073 = 248	574 = 249	4904 = 250	4782 = 251	3458 = 252	2987 = 253	3486 = 254	4888 = 255	1844 = 256	1567 = 257	4813 = 258	1676 = 259	1776 + e.k2359 + (e.k3119`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e38 = fill38(born());
function fill39(e) {`,
      [
        `958 = 0	4491 = 1	638 = 2	120 = 3	775 = 4	1433 = 5	4229 = 6	4778 = 7	4800 = 8	3683 = 9	2574 = 10	979 = 11	4694 = 12	958 + e.k4694 + (e.k2905
2140 = 13	3910 = 14	2173 = 15	2856 = 16	3157 = 17	1571 = 18	277 = 19	3803 = 20	2691 = 21	461 = 22	959 = 23	271 = 24	3306 = 25	3157 + e.k2140 + (e.k3265
4760 = 26	2766 = 27	1632 = 28	4885 = 29	2035 = 30	3977 = 31	2038 = 32	4081 = 33	2771 = 34	3549 = 35	1490 = 36	590 = 37	1137 = 38	1433 + e.k3306 + (e.k4934
1846 = 39	4520 = 40	2907 = 41	2344 = 42	1831 = 43	4897 = 44	1627 = 45	4939 = 46	2009 = 47	2954 = 48	4672 = 49	4644 = 50	1474 = 51	4491 + e.k2009 + (e.k3446
2244 = 52	2796 = 53	4130 = 54	1605 = 55	2229 = 56	4654 = 57	2470 = 58	2206 = 59	1030 = 60	1405 = 61	4625 = 62	2238 = 63	698 = 64	1846 + e.k1632 + (e.k1423
3219 = 65	125 = 66	4917 = 67	2769 = 68	4306 = 69	886 = 70	3788 = 71	2031 = 72	1559 = 73	2081 = 74	1539 = 75	4536 = 76	3660 = 77	3219 + e.k1627 + (e.k673
171 = 78	3208 = 79	2517 = 80	3345 = 81	3040 = 82	1274 = 83	916 = 84	3454 = 85	1565 = 86	4089 = 87	304 = 88	4311 = 89	4831 = 90	4672 + e.k1490 + (e.k610
4962 = 91	3405 = 92	4471 = 93	132 = 94	2378 = 95	2342 = 96	3391 = 97	3468 = 98	747 = 99	4319 = 100	3645 = 101	3132 = 102	1167 = 103	4885 + e.k2173 + (e.k3684
4808 = 104	4040 = 105	214 = 106	1381 = 107	3086 = 108	4875 = 109	3591 = 110	4817 = 111	2682 = 112	2393 = 113	2041 = 114	1514 = 115	3305 = 116	2378 + e.k4229 + (e.k1175
373 = 117	4032 = 118	3934 = 119	2319 = 120	932 = 121	3951 = 122	1232 = 123	827 = 124	1092 = 125	1419 = 126	4898 = 127	1147 = 128	2153 = 129	4897 + e.k3454 + (e.k3243
4605 = 130	4766 = 131	2339 = 132	1079 = 133	3298 = 134	3166 = 135	4788 = 136	9 = 137	3575 = 138	4719 = 139	3847 = 140	2256 = 141	1574 = 142	1381 + e.k2682 + (e.k4013
2438 = 143	4237 = 144	2634 = 145	468 = 146	2823 = 147	3477 = 148	3392 = 149	37 = 150	246 = 151	1877 = 152	988 = 153	152 = 154	3475 = 155	304 + e.k1559 + (e.k357
92 = 156	656 = 157	4725 = 158	421 = 159	4179 = 160	2186 = 161	2889 = 162	2890 = 163	4297 = 164	708 = 165	4776 = 166	2803 = 167	57 = 168	747 + e.k4917 + (e.k4460
3968 = 169	3007 = 170	2825 = 171	338 = 172	1802 = 173	1180 = 174	2236 = 175	911 = 176	735 = 177	1187 = 178	1954 = 179	2197 = 180	454 = 181	3306 + e.k1954 + (e.k18
4050 = 182	2807 = 183	2995 = 184	4293 = 185	3221 = 186	510 = 187	4693 = 188	2669 = 189	1426 = 190	4695 = 191	3510 = 192	4616 = 193	915 = 194	152 + e.k4040 + (e.k4231
3998 = 195	1708 = 196	4222 = 197	1902 = 198	3973 = 199	3080 = 200	733 = 201	3521 = 202	2592 = 203	1246 = 204	3216 = 205	689 = 206	1173 = 207	2244 + e.k1405 + (e.k52
2111 = 208	1161 = 209	3773 = 210	2967 = 211	178 = 212	2605 = 213	2258 = 214	789 = 215	4748 = 216	3236 = 217	2845 = 218	1276 = 219	1358 = 220	3216 + e.k2796 + (e.k2433
4454 = 221	216 = 222	4212 = 223	4065 = 224	3688 = 225	4458 = 226	2873 = 227	4881 = 228	3213 = 229	2401 = 230	2422 = 231	2816 = 232	2805 = 233	3305 + e.k2197 + (e.k2565
1479 = 234	2894 = 235	2585 = 236	552 = 237	2390 = 238	160 = 239	1640 = 240	4956 = 241	196 = 242	844 = 243	1493 = 244	3398 = 245	4254 = 246	1147 + e.k3510 + (e.k4951
1986 = 247	1934 = 248	953 = 249	4447 = 250	3955 = 251	1154 = 252	1028 = 253	491 = 254	267 = 255	4233 = 256	2204 = 257	69 = 258	745 = 259	2173 + e.k1986 + (e.k819`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e39 = fill39(born());
function fill40(e) {`,
      [
        `2299 = 0	219 = 1	141 = 2	1751 = 3	4124 = 4	840 = 5	1002 = 6	1253 = 7	3061 = 8	2073 = 9	980 = 10	1974 = 11	860 = 12	2299 + e.k3061 + (e.k1958
3225 = 13	4764 = 14	1569 = 15	3920 = 16	2080 = 17	3534 = 18	1169 = 19	1772 = 20	4649 = 21	1135 = 22	2945 = 23	1313 = 24	1801 = 25	3534 + e.k1974 + (e.k4567
3187 = 26	2909 = 27	3956 = 28	275 = 29	3447 = 30	1900 = 31	4149 = 32	4077 = 33	3539 = 34	3716 = 35	518 = 36	4692 = 37	605 = 38	141 + e.k4764 + (e.k841
4843 = 39	4281 = 40	3404 = 41	2699 = 42	4614 = 43	2948 = 44	1950 = 45	2774 = 46	2974 = 47	544 = 48	353 = 49	2979 = 50	1415 = 51	518 + e.k2974 + (e.k3916
2581 = 52	2321 = 53	2918 = 54	3137 = 55	3815 = 56	3396 = 57	1979 = 58	1439 = 59	4966 = 60	1414 = 61	4603 = 62	1987 = 63	396 = 64	860 + e.k2909 + (e.k4109
4278 = 65	4862 = 66	1972 = 67	1431 = 68	3141 = 69	1159 = 70	852 = 71	212 = 72	2234 = 73	3641 = 74	4615 = 75	1158 = 76	410 = 77	2774 + e.k1751 + (e.k3576
1680 = 78	32 = 79	469 = 80	3708 = 81	993 = 82	69 = 83	1307 = 84	3618 = 85	4047 = 86	2735 = 87	4948 = 88	1790 = 89	2218 = 90	219 + e.k4614 + (e.k2418
2384 = 91	3264 = 92	3439 = 93	4791 = 94	1492 = 95	1732 = 96	4540 = 97	1153 = 98	4662 = 99	2398 = 100	3562 = 101	277 = 102	3324 = 103	2384 + e.k4843 + (e.k3415
2474 = 104	864 = 105	3645 = 106	1571 = 107	60 = 108	1983 = 109	614 = 110	2003 = 111	3955 = 112	4164 = 113	1034 = 114	1888 = 115	4789 = 116	2909 + e.k4862 + (e.k3335
1295 = 117	4153 = 118	2142 = 119	1026 = 120	1627 = 121	3431 = 122	2880 = 123	4055 = 124	4537 = 125	4864 = 126	4678 = 127	2709 = 128	1008 = 129	3562 + e.k840 + (e.k2880
2578 = 130	4104 = 131	1557 = 132	4396 = 133	2390 = 134	4086 = 135	2822 = 136	2089 = 137	3119 = 138	2670 = 139	3650 = 140	4803 = 141	3633 = 142	69 + e.k852 + (e.k3140
2100 = 143	2881 = 144	2519 = 145	1140 = 146	1721 = 147	2025 = 148	1336 = 149	4548 = 150	1188 = 151	3173 = 152	1794 = 153	460 = 154	2932 = 155	3324 + e.k3708 + (e.k2827
4282 = 156	4240 = 157	1907 = 158	4657 = 159	3987 = 160	4076 = 161	3128 = 162	3647 = 163	2256 = 164	361 = 165	3032 = 166	2011 = 167	422 = 168	4104 + e.k2073 + (e.k2767
1042 = 169	759 = 170	2675 = 171	1333 = 172	4456 = 173	3629 = 174	1817 = 175	4380 = 176	3874 = 177	2611 = 178	2180 = 179	2179 = 180	569 = 181	3874 + e.k3633 + (e.k4017
848 = 182	4063 = 183	2747 = 184	1138 = 185	1777 = 186	95 = 187	3012 = 188	303 = 189	3361 = 190	3504 = 191	3762 = 192	4621 = 193	4358 = 194	1158 + e.k4948 + (e.k1308
4510 = 195	3545 = 196	171 = 197	4592 = 198	192 = 199	2848 = 200	1640 = 201	3797 = 202	1240 = 203	3694 = 204	4721 = 205	4257 = 206	1527 = 207	3361 + e.k3956 + (e.k2924
4676 = 208	2408 = 209	3139 = 210	2860 = 211	4965 = 212	1753 = 213	1317 = 214	931 = 215	4335 = 216	4357 = 217	2093 = 218	4777 = 219	2037 = 220	4537 + e.k3874 + (e.k58
4147 = 221	1161 = 222	295 = 223	4787 = 224	4448 = 225	757 = 226	4489 = 227	4893 = 228	974 = 229	3575 = 230	621 = 231	91 = 232	1942 = 233	1158 + e.k2179 + (e.k3527
1381 = 234	1370 = 235	3500 = 236	1421 = 237	1114 = 238	407 = 239	2172 = 240	709 = 241	476 = 242	264 = 243	1303 = 244	982 = 245	2378 = 246	852 + e.k1527 + (e.k867
585 = 247	1920 = 248	1149 = 249	1461 = 250	2899 = 251	3684 = 252	1688 = 253	1363 = 254	3317 = 255	1038 = 256	437 = 257	4451 = 258	4838 = 259	3317 + e.k219 + (e.k1858`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e40 = fill40(born());
function fill41(e) {`,
      [
        `4337 = 0	4551 = 1	4459 = 2	892 = 3	2634 = 4	1588 = 5	4433 = 6	2304 = 7	354 = 8	3372 = 9	2598 = 10	2764 = 11	2751 = 12	2751 + e.k892 + (e.k1951
2245 = 13	1129 = 14	4901 = 15	1009 = 16	306 = 17	4209 = 18	2267 = 19	1584 = 20	2398 = 21	3149 = 22	3974 = 23	977 = 24	1507 = 25	306 + e.k4209 + (e.k4885
3499 = 26	3292 = 27	1325 = 28	4273 = 29	1346 = 30	3740 = 31	2370 = 32	4576 = 33	2556 = 34	1104 = 35	3336 = 36	3177 = 37	2378 = 38	4209 + e.k4273 + (e.k1067
3265 = 39	2064 = 40	3137 = 41	4688 = 42	3210 = 43	193 = 44	1743 = 45	3323 = 46	2761 = 47	275 = 48	3062 = 49	4928 = 50	4732 = 51	3265 + e.k193 + (e.k1633
1664 = 52	424 = 53	1142 = 54	2367 = 55	3497 = 56	2600 = 57	2833 = 58	4799 = 59	1886 = 60	4630 = 61	4339 = 62	3319 = 63	3871 = 64	3292 + e.k3497 + (e.k2554
3246 = 65	4210 = 66	1075 = 67	4172 = 68	4741 = 69	3888 = 70	152 = 71	4480 = 72	745 = 73	1608 = 74	4143 = 75	482 = 76	1604 = 77	3177 + e.k4901 + (e.k4978
122 = 78	3780 = 79	4708 = 80	1180 = 81	2491 = 82	3300 = 83	3248 = 84	268 = 85	921 = 86	2476 = 87	159 = 88	2749 = 89	3309 = 90	159 + e.k2367 + (e.k4594
4099 = 91	4379 = 92	1379 = 93	3206 = 94	3724 = 95	4269 = 96	2385 = 97	4606 = 98	3037 = 99	4164 = 100	919 = 101	4463 = 102	3214 = 103	122 + e.k2749 + (e.k4074
1619 = 104	841 = 105	2149 = 106	304 = 107	4160 = 108	3909 = 109	4800 = 110	4818 = 111	204 = 112	4958 = 113	15 = 114	3416 = 115	2255 = 116	3497 + e.k4160 + (e.k1129
3456 = 117	2146 = 118	3183 = 119	507 = 120	2589 = 121	567 = 122	4801 = 123	693 = 124	11 = 125	4890 = 126	4415 = 127	4697 = 128	305 = 129	3336 + e.k3062 + (e.k1192
606 = 130	761 = 131	3514 = 132	1941 = 133	1197 = 134	4121 = 135	4490 = 136	138 = 137	2019 = 138	4357 = 139	3435 = 140	1339 = 141	4203 = 142	152 + e.k1129 + (e.k1512
3327 = 143	3558 = 144	2072 = 145	720 = 146	974 = 147	2706 = 148	3077 = 149	4831 = 150	2104 = 151	2784 = 152	1233 = 153	1457 = 154	2040 = 155	3319 + e.k2146 + (e.k1784
3948 = 156	1718 = 157	2503 = 158	985 = 159	313 = 160	3188 = 161	2159 = 162	785 = 163	3546 = 164	484 = 165	3559 = 166	1152 = 167	134 = 168	1197 + e.k3780 + (e.k317
648 = 169	2115 = 170	4999 = 171	932 = 172	164 = 173	3760 = 174	2033 = 175	2873 = 176	2991 = 177	4666 = 178	4377 = 179	934 = 180	221 = 181	932 + e.k3188 + (e.k1935
3673 = 182	4778 = 183	4931 = 184	3731 = 185	2752 = 186	1702 = 187	2030 = 188	3587 = 189	2505 = 190	2652 = 191	2182 = 192	655 = 193	1182 = 194	3177 + e.k1619 + (e.k3329
4310 = 195	647 = 196	4794 = 197	365 = 198	3007 = 199	1036 = 200	2119 = 201	2949 = 202	2350 = 203	3419 = 204	971 = 205	2501 = 206	4474 = 207	3188 + e.k2505 + (e.k451
279 = 208	3999 = 209	2271 = 210	3329 = 211	1642 = 212	884 = 213	3815 = 214	3557 = 215	1435 = 216	417 = 217	127 = 218	3745 = 219	2083 = 220	3546 + e.k3888 + (e.k4526
4957 = 221	4868 = 222	801 = 223	4041 = 224	1652 = 225	2122 = 226	2627 = 227	1994 = 228	3879 = 229	584 = 230	766 = 231	4398 = 232	1837 = 233	3760 + e.k1325 + (e.k1476
4700 = 234	1751 = 235	4936 = 236	2438 = 237	3725 = 238	2822 = 239	4362 = 240	1572 = 241	445 = 242	1622 = 243	715 = 244	4481 = 245	3657 = 246	2040 + e.k4957 + (e.k3614
298 = 247	3784 = 248	3650 = 249	4107 = 250	2192 = 251	431 = 252	2194 = 253	1545 = 254	2802 = 255	1862 = 256	176 = 257	1627 = 258	2821 = 259	2784 + e.k3815 + (e.k752`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e41 = fill41(born());
function fill42(e) {`,
      [
        `1675 = 0	3129 = 1	2684 = 2	1756 = 3	2035 = 4	1888 = 5	4589 = 6	4414 = 7	3110 = 8	2014 = 9	3203 = 10	3213 = 11	3002 = 12	2014 + e.k4589 + (e.k3650
2206 = 13	3474 = 14	1588 = 15	2186 = 16	4580 = 17	2550 = 18	4984 = 19	727 = 20	2026 = 21	2419 = 22	1885 = 23	4118 = 24	264 = 25	3213 + e.k2026 + (e.k2254
329 = 26	2988 = 27	536 = 28	1016 = 29	390 = 30	4440 = 31	1229 = 32	2264 = 33	3859 = 34	836 = 35	3612 = 36	2672 = 37	915 = 38	1756 + e.k1885 + (e.k95
1538 = 39	2751 = 40	546 = 41	3061 = 42	20 = 43	4865 = 44	1495 = 45	1884 = 46	4001 = 47	173 = 48	2421 = 49	4386 = 50	1138 = 51	173 + e.k836 + (e.k1734
157 = 52	4103 = 53	3946 = 54	514 = 55	950 = 56	4843 = 57	352 = 58	2481 = 59	960 = 60	242 = 61	890 = 62	2112 = 63	1853 = 64	1538 + e.k536 + (e.k4223
537 = 65	1806 = 66	2343 = 67	2980 = 68	3315 = 69	3632 = 70	4234 = 71	4409 = 72	4284 = 73	1652 = 74	651 = 75	3718 = 76	158 = 77	836 + e.k157 + (e.k1124
2071 = 78	1300 = 79	755 = 80	2279 = 81	4316 = 82	4789 = 83	485 = 84	4248 = 85	2615 = 86	1543 = 87	4791 = 88	480 = 89	2739 = 90	485 + e.k2751 + (e.k1638
1190 = 91	4584 = 92	1897 = 93	2667 = 94	2602 = 95	926 = 96	441 = 97	3220 = 98	2713 = 99	2472 = 100	1453 = 101	4024 = 102	4840 = 103	2419 + e.k2980 + (e.k2095
4100 = 104	1378 = 105	240 = 106	4623 = 107	4833 = 108	2936 = 109	4972 = 110	2493 = 111	3526 = 112	1511 = 113	3369 = 114	4426 = 115	4845 = 116	2988 + e.k4440 + (e.k2354
1478 = 117	4471 = 118	2661 = 119	4119 = 120	1025 = 121	4456 = 122	2680 = 123	908 = 124	1346 = 125	1762 = 126	269 = 127	2721 = 128	4808 = 129	2421 + e.k1190 + (e.k2669
3287 = 130	1863 = 131	793 = 132	3066 = 133	1289 = 134	2663 = 135	3960 = 136	577 = 137	4958 = 138	4259 = 139	2410 = 140	2378 = 141	1286 = 142	352 + e.k2672 + (e.k2527
928 = 143	1606 = 144	717 = 145	3898 = 146	3501 = 147	1911 = 148	376 = 149	786 = 150	4461 = 151	481 = 152	4666 = 153	788 = 154	1256 = 155	20 + e.k2713 + (e.k4404
3302 = 156	4957 = 157	4768 = 158	2922 = 159	465 = 160	4763 = 161	4043 = 162	3170 = 163	3107 = 164	2459 = 165	4274 = 166	741 = 167	3741 = 168	4119 + e.k4791 + (e.k2743
1731 = 169	4556 = 170	3782 = 171	62 = 172	2411 = 173	4831 = 174	3093 = 175	1011 = 176	4193 = 177	1142 = 178	4464 = 179	657 = 180	3872 = 181	441 + e.k2615 + (e.k1660
298 = 182	1527 = 183	3981 = 184	720 = 185	406 = 186	1216 = 187	4700 = 188	3271 = 189	2860 = 190	4585 = 191	1338 = 192	2858 = 193	4624 = 194	2858 + e.k4001 + (e.k609
1660 = 195	2826 = 196	2999 = 197	2526 = 198	794 = 199	3694 = 200	457 = 201	4501 = 202	3076 = 203	2867 = 204	2844 = 205	4261 = 206	5 = 207	20 + e.k3872 + (e.k2348
4419 = 208	1425 = 209	4495 = 210	512 = 211	965 = 212	1984 = 213	2445 = 214	1873 = 215	721 = 216	3620 = 217	1194 = 218	4712 = 219	4579 = 220	717 + e.k2858 + (e.k3730
1965 = 221	2644 = 222	2192 = 223	2620 = 224	797 = 225	494 = 226	2775 = 227	2307 = 228	2195 = 229	3218 = 230	4989 = 231	3318 = 232	2829 = 233	1762 + e.k4274 + (e.k140
2625 = 234	2971 = 235	1243 = 236	2939 = 237	812 = 238	4306 = 239	235 = 240	1222 = 241	364 = 242	295 = 243	3167 = 244	3329 = 245	3608 = 246	1478 + e.k965 + (e.k1028
2564 = 247	2551 = 248	2358 = 249	593 = 250	4662 = 251	2953 = 252	3118 = 253	2394 = 254	1956 = 255	3896 = 256	1211 = 257	1385 = 258	1230 = 259	4666 + e.k3946 + (e.k4738`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e42 = fill42(born());
function fill43(e) {`,
      [
        `4472 = 0	2452 = 1	452 = 2	3141 = 3	2774 = 4	3267 = 5	3617 = 6	3537 = 7	1378 = 8	4067 = 9	860 = 10	1687 = 11	893 = 12	860 + e.k1687 + (e.k3207
2116 = 13	35 = 14	1852 = 15	3722 = 16	2864 = 17	774 = 18	4390 = 19	522 = 20	2687 = 21	4677 = 22	1715 = 23	3330 = 24	1598 = 25	893 + e.k4067 + (e.k3856
3354 = 26	3339 = 27	2923 = 28	392 = 29	2319 = 30	1324 = 31	2380 = 32	85 = 33	3153 = 34	4846 = 35	4197 = 36	4285 = 37	3314 = 38	3354 + e.k452 + (e.k263
4882 = 39	1138 = 40	3208 = 41	2167 = 42	4223 = 43	674 = 44	1718 = 45	2421 = 46	390 = 47	2598 = 48	1085 = 49	430 = 50	4010 = 51	1138 + e.k4067 + (e.k659
4297 = 52	1603 = 53	1792 = 54	4806 = 55	1906 = 56	1830 = 57	3724 = 58	3479 = 59	3260 = 60	1264 = 61	1930 = 62	2382 = 63	2994 = 64	3339 + e.k4472 + (e.k1194
1855 = 65	3856 = 66	2503 = 67	302 = 68	259 = 69	1059 = 70	4857 = 71	4140 = 72	1700 = 73	3665 = 74	2089 = 75	4235 = 76	3066 = 77	2089 + e.k2116 + (e.k3587
4369 = 78	4100 = 79	1808 = 80	2206 = 81	2937 = 82	931 = 83	658 = 84	2007 = 85	3021 = 86	30 = 87	1724 = 88	2226 = 89	879 = 90	1930 + e.k3260 + (e.k3192
4888 = 91	2111 = 92	1812 = 93	3285 = 94	4766 = 95	2320 = 96	3358 = 97	1385 = 98	2748 = 99	4514 = 100	2967 = 101	4434 = 102	4365 = 103	4766 + e.k4197 + (e.k1184
2310 = 104	4879 = 105	364 = 106	2556 = 107	883 = 108	1270 = 109	4242 = 110	3767 = 111	4765 = 112	3054 = 113	3420 = 114	4903 = 115	4158 = 116	2310 + e.k3285 + (e.k1092
2642 = 117	4035 = 118	3568 = 119	4315 = 120	1014 = 121	2441 = 122	4005 = 123	4464 = 124	3763 = 125	3932 = 126	3987 = 127	3340 = 128	2042 = 129	2007 + e.k1687 + (e.k1035
4799 = 130	2723 = 131	2790 = 132	4001 = 133	1298 = 134	3429 = 135	4170 = 136	461 = 137	570 = 138	2210 = 139	3156 = 140	4558 = 141	4945 = 142	1264 + e.k3156 + (e.k1843
3290 = 143	142 = 144	1139 = 145	3199 = 146	4986 = 147	4567 = 148	4924 = 149	888 = 150	3044 = 151	1261 = 152	4387 = 153	3389 = 154	3972 = 155	3767 + e.k3153 + (e.k309
3085 = 156	4802 = 157	4217 = 158	4188 = 159	724 = 160	2895 = 161	3378 = 162	3250 = 163	172 = 164	3071 = 165	642 = 166	819 = 167	2750 = 168	1855 + e.k4188 + (e.k1647
3306 = 169	2287 = 170	1840 = 171	4338 = 172	844 = 173	582 = 174	4947 = 175	991 = 176	2359 = 177	3268 = 178	64 = 179	3115 = 180	1153 = 181	85 + e.k3330 + (e.k2752
3883 = 182	4869 = 183	1171 = 184	2786 = 185	1246 = 186	2615 = 187	168 = 188	2872 = 189	2669 = 190	3188 = 191	3756 = 192	1013 = 193	1222 = 194	1840 + e.k3883 + (e.k162
3587 = 195	1329 = 196	4581 = 197	1949 = 198	363 = 199	3937 = 200	3063 = 201	2336 = 202	3039 = 203	1276 = 204	3259 = 205	4119 = 206	1946 = 207	3429 + e.k4315 + (e.k2624
901 = 208	898 = 209	828 = 210	1101 = 211	2858 = 212	2784 = 213	1179 = 214	792 = 215	1304 = 216	4696 = 217	1905 = 218	701 = 219	4451 = 220	4010 + e.k3330 + (e.k1690
2626 = 221	2048 = 222	1760 = 223	4552 = 224	2683 = 225	4850 = 226	2047 = 227	4211 = 228	4640 = 229	4510 = 230	1434 = 231	2792 = 232	3222 = 233	392 + e.k4100 + (e.k2894
4371 = 234	2876 = 235	3777 = 236	4982 = 237	3322 = 238	3062 = 239	1595 = 240	4046 = 241	1394 = 242	4890 = 243	3261 = 244	3338 = 245	1660 = 246	1264 + e.k4242 + (e.k1834
2107 = 247	88 = 248	2773 = 249	1925 = 250	179 = 251	279 = 252	2121 = 253	4313 = 254	1521 = 255	3166 = 256	1837 = 257	3415 = 258	1436 = 259	1830 + e.k2895 + (e.k2334`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e43 = fill43(born());
function fill44(e) {`,
      [
        `2211 = 0	3877 = 1	1070 = 2	4099 = 3	81 = 4	3957 = 5	471 = 6	4279 = 7	2447 = 8	2063 = 9	3801 = 10	2608 = 11	328 = 12	3801 + e.k81 + (e.k2150
4999 = 13	3385 = 14	4939 = 15	4728 = 16	1415 = 17	1508 = 18	875 = 19	1137 = 20	1332 = 21	3342 = 22	4826 = 23	4876 = 24	241 = 25	3385 + e.k4999 + (e.k1947
2837 = 26	2333 = 27	632 = 28	4549 = 29	2378 = 30	825 = 31	1572 = 32	3173 = 33	4346 = 34	4864 = 35	56 = 36	474 = 37	1340 = 38	2333 + e.k4939 + (e.k3416
3971 = 39	3200 = 40	1412 = 41	3420 = 42	363 = 43	2893 = 44	584 = 45	2817 = 46	1936 = 47	2638 = 48	945 = 49	4594 = 50	400 = 51	2333 + e.k1415 + (e.k4962
4600 = 52	518 = 53	3341 = 54	1967 = 55	2858 = 56	2316 = 57	1465 = 58	4878 = 59	2709 = 60	2390 = 61	3242 = 62	3275 = 63	3779 = 64	4279 + e.k1572 + (e.k2852
1146 = 65	4603 = 66	3743 = 67	3727 = 68	3446 = 69	133 = 70	2487 = 71	3652 = 72	2415 = 73	3853 = 74	2062 = 75	272 = 76	1163 = 77	2415 + e.k272 + (e.k418
406 = 78	1095 = 79	1966 = 80	4613 = 81	1999 = 82	267 = 83	824 = 84	3609 = 85	4219 = 86	884 = 87	3561 = 88	4628 = 89	4703 = 90	1572 + e.k3200 + (e.k4907
1099 = 91	4340 = 92	2258 = 93	3234 = 94	2466 = 95	948 = 96	324 = 97	1365 = 98	1922 = 99	1248 = 100	2972 = 101	3796 = 102	2906 = 103	2858 + e.k471 + (e.k2613
2216 = 104	2668 = 105	1755 = 106	4570 = 107	3092 = 108	2309 = 109	3587 = 110	1290 = 111	2482 = 112	1343 = 113	1244 = 114	986 = 115	2142 = 116	1340 + e.k1936 + (e.k1830
4951 = 117	4688 = 118	692 = 119	4412 = 120	2865 = 121	2937 = 122	698 = 123	2411 = 124	2874 = 125	629 = 126	3272 = 127	4907 = 128	2475 = 129	400 + e.k2062 + (e.k358
92 = 130	349 = 131	4853 = 132	1676 = 133	1675 = 134	2436 = 135	1715 = 136	3423 = 137	4245 = 138	318 = 139	4254 = 140	3675 = 141	1406 = 142	3587 + e.k3446 + (e.k3420
2629 = 143	3181 = 144	2167 = 145	3111 = 146	4182 = 147	1002 = 148	102 = 149	4191 = 150	434 = 151	1411 = 152	3828 = 153	424 = 154	1568 = 155	2333 + e.k3275 + (e.k4971
4797 = 156	227 = 157	4444 = 158	670 = 159	2589 = 160	3624 = 161	791 = 162	2561 = 163	2381 = 164	437 = 165	657 = 166	323 = 167	3867 = 168	1070 + e.k3092 + (e.k4481
848 = 169	2528 = 170	370 = 171	3923 = 172	1345 = 173	922 = 174	2489 = 175	3994 = 176	1221 = 177	4460 = 178	2653 = 179	3762 = 180	425 = 181	102 + e.k133 + (e.k1376
973 = 182	1312 = 183	3530 = 184	2774 = 185	3003 = 186	125 = 187	966 = 188	2051 = 189	1260 = 190	3035 = 191	1690 = 192	944 = 193	3057 = 194	2051 + e.k267 + (e.k1007
3297 = 195	3669 = 196	401 = 197	647 = 198	1432 = 199	2925 = 200	62 = 201	2020 = 202	2549 = 203	2366 = 204	1841 = 205	1710 = 206	1481 = 207	349 + e.k3423 + (e.k3912
3507 = 208	47 = 209	2956 = 210	450 = 211	3844 = 212	4168 = 213	696 = 214	3770 = 215	4943 = 216	490 = 217	1770 = 218	1035 = 219	2993 = 220	4549 + e.k4340 + (e.k3055
3613 = 221	3329 = 222	1142 = 223	1824 = 224	1076 = 225	1196 = 226	527 = 227	1237 = 228	797 = 229	3465 = 230	4384 = 231	4519 = 232	835 = 233	2216 + e.k1966 + (e.k734
4341 = 234	3775 = 235	3814 = 236	4257 = 237	3265 = 238	2941 = 239	374 = 240	748 = 241	1610 = 242	207 = 243	3741 = 244	783 = 245	3557 = 246	4245 + e.k3779 + (e.k2669
2627 = 247	2398 = 248	3235 = 249	4108 = 250	408 = 251	4188 = 252	4984 = 253	3301 = 254	1457 = 255	2924 = 256	2215 = 257	2928 = 258	1478 = 259	3853 + e.k4907 + (e.k376`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e44 = fill44(born());
function fill45(e) {`,
      [
        `3381 = 0	3357 = 1	146 = 2	3246 = 3	2773 = 4	1865 = 5	4135 = 6	2878 = 7	2057 = 8	3155 = 9	361 = 10	4692 = 11	3709 = 12	146 + e.k3246 + (e.k4738
1401 = 13	1798 = 14	4175 = 15	3916 = 16	4748 = 17	4731 = 18	3917 = 19	4351 = 20	2615 = 21	4985 = 22	797 = 23	1668 = 24	1383 = 25	4135 + e.k361 + (e.k2564
2975 = 26	2644 = 27	4788 = 28	3240 = 29	2685 = 30	1122 = 31	3358 = 32	3121 = 33	90 = 34	2981 = 35	3799 = 36	4082 = 37	2794 = 38	3155 + e.k361 + (e.k1604
326 = 39	4162 = 40	4758 = 41	4617 = 42	3603 = 43	619 = 44	1928 = 45	4908 = 46	2004 = 47	1706 = 48	266 = 49	499 = 50	2262 = 51	2794 + e.k3709 + (e.k1270
2338 = 52	4117 = 53	4954 = 54	913 = 55	3029 = 56	899 = 57	4427 = 58	4928 = 59	1253 = 60	1674 = 61	3102 = 62	1753 = 63	1836 = 64	4351 + e.k3709 + (e.k3267
1695 = 65	1540 = 66	1290 = 67	273 = 68	4855 = 69	1227 = 70	719 = 71	1174 = 72	3809 = 73	3499 = 74	4633 = 75	2399 = 76	4455 = 77	4788 + e.k1383 + (e.k4307
1470 = 78	1572 = 79	2296 = 80	1453 = 81	2800 = 82	2355 = 83	2482 = 84	3405 = 85	2992 = 86	330 = 87	2603 = 88	4932 = 89	3051 = 90	2004 + e.k2685 + (e.k1030
612 = 91	904 = 92	4017 = 93	414 = 94	4680 = 95	2820 = 96	1775 = 97	699 = 98	3642 = 99	92 = 100	1623 = 101	284 = 102	441 = 103	326 + e.k3121 + (e.k3569
2408 = 104	1687 = 105	1094 = 106	1386 = 107	1341 = 108	3672 = 109	2885 = 110	2961 = 111	3854 = 112	866 = 113	3401 = 114	1106 = 115	359 = 116	3499 + e.k4082 + (e.k4555
3757 = 117	3370 = 118	4363 = 119	2493 = 120	975 = 121	2028 = 122	1720 = 123	1917 = 124	698 = 125	3080 = 126	3880 = 127	3042 = 128	2095 = 129	1720 + e.k866 + (e.k4250
1186 = 130	152 = 131	1791 = 132	4673 = 133	2873 = 134	770 = 135	2912 = 136	14 = 137	477 = 138	3150 = 139	1760 = 140	2640 = 141	2427 = 142	414 + e.k330 + (e.k2837
4022 = 143	1447 = 144	3690 = 145	3765 = 146	4639 = 147	1224 = 148	3856 = 149	2552 = 150	2999 = 151	4967 = 152	782 = 153	2827 = 154	3758 = 155	1453 + e.k1227 + (e.k791
4655 = 156	3653 = 157	2900 = 158	320 = 159	4242 = 160	2444 = 161	1619 = 162	1300 = 163	2778 = 164	860 = 165	3342 = 166	3138 = 167	4164 = 168	4985 + e.k2004 + (e.k406
3467 = 169	2002 = 170	1956 = 171	3001 = 172	2120 = 173	4845 = 174	2709 = 175	1898 = 176	1947 = 177	1359 = 178	528 = 179	1641 = 180	2045 = 181	3138 + e.k2004 + (e.k4951
4568 = 182	3693 = 183	4334 = 184	3386 = 185	1792 = 186	816 = 187	3203 = 188	271 = 189	3564 = 190	2821 = 191	2119 = 192	737 = 193	302 = 194	2821 + e.k1956 + (e.k4459
160 = 195	724 = 196	1559 = 197	714 = 198	4754 = 199	4085 = 200	798 = 201	742 = 202	1260 = 203	2612 = 204	2635 = 205	1446 = 206	1721 = 207	2552 + e.k1865 + (e.k1128
3591 = 208	4130 = 209	4429 = 210	2340 = 211	4793 = 212	3072 = 213	3032 = 214	4661 = 215	1081 = 216	2906 = 217	3654 = 218	3212 = 219	513 = 220	2552 + e.k3880 + (e.k3566
1384 = 221	2207 = 222	1651 = 223	802 = 224	4328 = 225	2135 = 226	920 = 227	3845 = 228	4730 = 229	3427 = 230	3079 = 231	846 = 232	584 = 233	92 + e.k2340 + (e.k4493
58 = 234	1565 = 235	4270 = 236	4852 = 237	2537 = 238	933 = 239	2970 = 240	2922 = 241	2897 = 242	3142 = 243	4194 = 244	1064 = 245	1508 = 246	1623 + e.k1898 + (e.k2982
3743 = 247	3375 = 248	1833 = 249	801 = 250	1200 = 251	2931 = 252	1142 = 253	138 = 254	3554 = 255	3484 = 256	1941 = 257	1325 = 258	3068 = 259	3080 + e.k3080 + (e.k1545`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e45 = fill45(born());
function fill46(e) {`,
      [
        `906 = 0	4097 = 1	3053 = 2	1944 = 3	4616 = 4	2339 = 5	3474 = 6	2586 = 7	4075 = 8	989 = 9	802 = 10	139 = 11	2660 = 12	139 + e.k2586 + (e.k3782
4743 = 13	1102 = 14	3637 = 15	1125 = 16	613 = 17	444 = 18	337 = 19	955 = 20	4072 = 21	4051 = 22	1994 = 23	4982 = 24	1884 = 25	2586 + e.k444 + (e.k199
1678 = 26	2164 = 27	1040 = 28	717 = 29	4668 = 30	1750 = 31	4721 = 32	3684 = 33	3838 = 34	3518 = 35	3076 = 36	3085 = 37	4819 = 38	906 + e.k3474 + (e.k2125
4468 = 39	1091 = 40	1497 = 41	2428 = 42	4660 = 43	4707 = 44	1201 = 45	4857 = 46	3035 = 47	3278 = 48	3612 = 49	1211 = 50	4359 = 51	4072 + e.k3474 + (e.k3081
3404 = 52	734 = 53	2964 = 54	2637 = 55	4575 = 56	2742 = 57	3437 = 58	419 = 59	4261 = 60	4092 = 61	495 = 62	1303 = 63	3941 = 64	3637 + e.k1125 + (e.k749
74 = 65	2860 = 66	4814 = 67	1332 = 68	3233 = 69	4269 = 70	1424 = 71	3922 = 72	1704 = 73	4745 = 74	4327 = 75	3693 = 76	1898 = 77	4359 + e.k3278 + (e.k2083
4740 = 78	1740 = 79	2832 = 80	1021 = 81	1210 = 82	4282 = 83	3496 = 84	2241 = 85	97 = 86	566 = 87	137 = 88	623 = 89	4956 = 90	989 + e.k444 + (e.k1733
3492 = 91	2045 = 92	3781 = 93	366 = 94	4416 = 95	4330 = 96	3975 = 97	4089 = 98	3331 = 99	860 = 100	1146 = 101	3149 = 102	902 = 103	4956 + e.k4743 + (e.k1785
3945 = 104	2828 = 105	4568 = 106	90 = 107	2802 = 108	3052 = 109	2987 = 110	4015 = 111	3551 = 112	3778 = 113	1184 = 114	3245 = 115	814 = 116	2045 + e.k3492 + (e.k3807
4974 = 117	1731 = 118	1351 = 119	4294 = 120	2800 = 121	1789 = 122	3376 = 123	4464 = 124	2935 = 125	309 = 126	2971 = 127	980 = 128	101 = 129	1091 + e.k4294 + (e.k3318
3041 = 130	1220 = 131	365 = 132	3335 = 133	672 = 134	1534 = 135	2932 = 136	4649 = 137	4046 = 138	1581 = 139	3016 = 140	3799 = 141	4683 = 142	672 + e.k4668 + (e.k2806
740 = 143	3456 = 144	2873 = 145	4887 = 146	2977 = 147	2801 = 148	2541 = 149	2787 = 150	2590 = 151	1611 = 152	3336 = 153	608 = 154	2575 = 155	419 + e.k3612 + (e.k3620
3979 = 156	1711 = 157	4614 = 158	846 = 159	1444 = 160	3579 = 161	1492 = 162	620 = 163	1779 = 164	4730 = 165	3755 = 166	1921 = 167	3587 = 168	1884 + e.k3492 + (e.k981
1825 = 169	102 = 170	3643 = 171	4475 = 172	494 = 173	947 = 174	4322 = 175	2776 = 176	2570 = 177	1796 = 178	4243 = 179	441 = 180	1205 = 181	4359 + e.k1210 + (e.k2361
4675 = 182	2287 = 183	3560 = 184	741 = 185	573 = 186	2333 = 187	3602 = 188	371 = 189	1637 = 190	2328 = 191	1121 = 192	3487 = 193	257 = 194	2428 + e.k4568 + (e.k3248
2724 = 195	4107 = 196	2147 = 197	2401 = 198	2410 = 199	2678 = 200	3707 = 201	2136 = 202	4127 = 203	3951 = 204	1973 = 205	1583 = 206	3006 = 207	1750 + e.k419 + (e.k1042
214 = 208	897 = 209	108 = 210	154 = 211	1375 = 212	1910 = 213	2561 = 214	2440 = 215	4297 = 216	3028 = 217	4453 = 218	1797 = 219	180 = 220	4974 + e.k4730 + (e.k3604
1911 = 221	4318 = 222	927 = 223	2683 = 224	1432 = 225	2256 = 226	1538 = 227	4506 = 228	209 = 229	1374 = 230	3987 = 231	4785 = 232	3537 = 233	4330 + e.k3456 + (e.k3021
20 = 234	1301 = 235	1044 = 236	3104 = 237	4937 = 238	3111 = 239	1384 = 240	2849 = 241	2011 = 242	4381 = 243	3774 = 244	1955 = 245	2536 = 246	4721 + e.k4243 + (e.k3310
4728 = 247	3147 = 248	174 = 249	2324 = 250	1194 = 251	60 = 252	4512 = 253	3316 = 254	3814 = 255	2497 = 256	4353 = 257	4581 = 258	4449 = 259	1497 + e.k4683 + (e.k568`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e46 = fill46(born());
function fill47(e) {`,
      [
        `3484 = 0	4159 = 1	1652 = 2	1167 = 3	1560 = 4	2945 = 5	1898 = 6	4533 = 7	1423 = 8	4001 = 9	4020 = 10	1966 = 11	1037 = 12	1037 + e.k4001 + (e.k4732
2210 = 13	3321 = 14	3323 = 15	1963 = 16	2955 = 17	3509 = 18	1950 = 19	2363 = 20	4405 = 21	2590 = 22	770 = 23	505 = 24	2928 = 25	1898 + e.k1963 + (e.k207
218 = 26	3690 = 27	532 = 28	986 = 29	3500 = 30	1718 = 31	2988 = 32	7 = 33	1715 = 34	1446 = 35	3606 = 36	2658 = 37	4034 = 38	1037 + e.k986 + (e.k2952
551 = 39	3217 = 40	2749 = 41	2437 = 42	3062 = 43	1651 = 44	697 = 45	679 = 46	784 = 47	540 = 48	2642 = 49	3438 = 50	2786 = 51	4533 + e.k3217 + (e.k1242
3763 = 52	1275 = 53	4575 = 54	1785 = 55	4591 = 56	124 = 57	661 = 58	4711 = 59	2212 = 60	1814 = 61	2249 = 62	4852 = 63	1484 = 64	4591 + e.k1966 + (e.k858
1876 = 65	3770 = 66	1419 = 67	1936 = 68	2806 = 69	2148 = 70	4474 = 71	3192 = 72	3768 = 73	2697 = 74	2322 = 75	2337 = 76	95 = 77	3606 + e.k4020 + (e.k1310
4094 = 78	960 = 79	4229 = 80	3239 = 81	3067 = 82	169 = 83	4722 = 84	1063 = 85	2234 = 86	1753 = 87	629 = 88	2601 = 89	2272 = 90	2272 + e.k4229 + (e.k4066
1357 = 91	4506 = 92	86 = 93	3456 = 94	3942 = 95	4433 = 96	3311 = 97	1 = 98	1353 = 99	1236 = 100	1531 = 101	70 = 102	3055 = 103	2642 + e.k124 + (e.k4892
4399 = 104	2709 = 105	1758 = 106	659 = 107	321 = 108	4430 = 109	4663 = 110	4188 = 111	3724 = 112	4524 = 113	2569 = 114	4535 = 115	3088 = 116	629 + e.k4399 + (e.k4265
3148 = 117	3943 = 118	2836 = 119	2703 = 120	1360 = 121	2496 = 122	1857 = 123	4010 = 124	4933 = 125	2571 = 126	1735 = 127	4231 = 128	3356 = 129	4591 + e.k4159 + (e.k3614
2231 = 130	4787 = 131	18 = 132	3399 = 133	759 = 134	865 = 135	4570 = 136	518 = 137	2772 = 138	4332 = 139	3860 = 140	1736 = 141	4600 = 142	3088 + e.k1785 + (e.k3356
2559 = 143	820 = 144	2511 = 145	2844 = 146	3070 = 147	4669 = 148	1075 = 149	488 = 150	3033 = 151	1383 = 152	2526 = 153	512 = 154	2427 = 155	2955 + e.k770 + (e.k333
2054 = 156	1030 = 157	411 = 158	398 = 159	2048 = 160	1619 = 161	1299 = 162	4599 = 163	2091 = 164	3780 = 165	3001 = 166	160 = 167	4694 = 168	218 + e.k4663 + (e.k2793
3091 = 169	1877 = 170	978 = 171	3807 = 172	2760 = 173	4471 = 174	3764 = 175	2975 = 176	1493 = 177	4900 = 178	4843 = 179	3975 = 180	856 = 181	2975 + e.k4094 + (e.k1500
4932 = 182	274 = 183	42 = 184	2612 = 185	2042 = 186	993 = 187	4925 = 188	239 = 189	1474 = 190	1207 = 191	410 = 192	3347 = 193	2189 = 194	3975 + e.k532 + (e.k4869
3508 = 195	1372 = 196	4851 = 197	347 = 198	3107 = 199	3280 = 200	3050 = 201	893 = 202	3520 = 203	324 = 204	4883 = 205	2010 = 206	779 = 207	993 + e.k1753 + (e.k3317
1470 = 208	2723 = 209	51 = 210	1662 = 211	4854 = 212	4170 = 213	2286 = 214	4293 = 215	382 = 216	1641 = 217	1429 = 218	3259 = 219	1956 = 220	3091 + e.k3860 + (e.k3372
4086 = 221	4673 = 222	1901 = 223	908 = 224	4102 = 225	3288 = 226	2843 = 227	243 = 228	4989 = 229	197 = 230	2939 = 231	473 = 232	423 = 233	2231 + e.k1736 + (e.k4692
3819 = 234	4747 = 235	1102 = 236	2910 = 237	79 = 238	2255 = 239	3989 = 240	3264 = 241	1959 = 242	2978 = 243	32 = 244	1774 = 245	3295 = 246	4430 + e.k218 + (e.k2051
4898 = 247	3913 = 248	2303 = 249	2413 = 250	2728 = 251	1193 = 252	1296 = 253	235 = 254	4720 = 255	4168 = 256	3498 = 257	2102 = 258	4957 = 259	1662 + e.k1950 + (e.k352`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e47 = fill47(born());
function fill48(e) {`,
      [
        `405 = 0	2098 = 1	1993 = 2	726 = 3	1024 = 4	1399 = 5	4612 = 6	3885 = 7	2942 = 8	1349 = 9	1744 = 10	2763 = 11	4124 = 12	1024 + e.k1993 + (e.k4756
2019 = 13	4795 = 14	4989 = 15	4161 = 16	946 = 17	2556 = 18	3050 = 19	1415 = 20	3193 = 21	921 = 22	359 = 23	1910 = 24	610 = 25	1349 + e.k610 + (e.k1633
659 = 26	1689 = 27	4816 = 28	1961 = 29	1819 = 30	1710 = 31	849 = 32	176 = 33	4517 = 34	255 = 35	1529 = 36	514 = 37	2377 = 38	4124 + e.k4612 + (e.k4312
4520 = 39	681 = 40	1226 = 41	1698 = 42	1968 = 43	165 = 44	1207 = 45	696 = 46	4240 = 47	1717 = 48	3911 = 49	837 = 50	3042 = 51	4161 + e.k176 + (e.k2178
1872 = 52	1831 = 53	3317 = 54	4615 = 55	4399 = 56	2642 = 57	4927 = 58	1431 = 59	909 = 60	3564 = 61	4652 = 62	2343 = 63	4829 = 64	1698 + e.k681 + (e.k4574
480 = 65	649 = 66	2319 = 67	4260 = 68	419 = 69	3414 = 70	4332 = 71	247 = 72	1846 = 73	14 = 74	4269 = 75	2644 = 76	842 = 77	4161 + e.k659 + (e.k495
3841 = 78	1730 = 79	2409 = 80	1137 = 81	4724 = 82	2013 = 83	913 = 84	4990 = 85	223 = 86	1489 = 87	4259 = 88	917 = 89	2080 = 90	837 + e.k909 + (e.k2031
4310 = 91	369 = 92	1911 = 93	1678 = 94	3079 = 95	3621 = 96	1707 = 97	1662 = 98	556 = 99	1012 = 100	3202 = 101	353 = 102	4022 = 103	3050 + e.k353 + (e.k3967
4020 = 104	1300 = 105	587 = 106	2633 = 107	763 = 108	491 = 109	518 = 110	3345 = 111	3211 = 112	4025 = 113	4751 = 114	1214 = 115	2793 = 116	4652 + e.k480 + (e.k4804
208 = 117	571 = 118	149 = 119	3639 = 120	4181 = 121	2354 = 122	3996 = 123	2172 = 124	1581 = 125	3979 = 126	3551 = 127	354 = 128	3330 = 129	4260 + e.k3202 + (e.k1264
679 = 130	4975 = 131	2481 = 132	914 = 133	4936 = 134	4330 = 135	2872 = 136	2418 = 137	517 = 138	2092 = 139	1978 = 140	4523 = 141	3352 = 142	4124 + e.k1744 + (e.k1469
2154 = 143	4387 = 144	4258 = 145	2711 = 146	1922 = 147	2695 = 148	4084 = 149	1616 = 150	4727 = 151	366 = 152	1588 = 153	1963 = 154	4791 = 155	4936 + e.k2763 + (e.k4909
2801 = 156	104 = 157	1054 = 158	387 = 159	3314 = 160	3021 = 161	4138 = 162	4719 = 163	1383 = 164	4012 = 165	1461 = 166	2480 = 167	2176 = 168	14 + e.k3330 + (e.k4426
2520 = 169	3305 = 170	1816 = 171	1625 = 172	4256 = 173	1459 = 174	46 = 175	1370 = 176	3959 = 177	68 = 178	372 = 179	126 = 180	4270 = 181	4269 + e.k4791 + (e.k3011
4427 = 182	1582 = 183	156 = 184	2609 = 185	2157 = 186	141 = 187	4100 = 188	2528 = 189	1883 = 190	2291 = 191	1526 = 192	17 = 193	4620 = 194	4751 + e.k1526 + (e.k3663
3217 = 195	2615 = 196	865 = 197	28 = 198	2933 = 199	1239 = 200	318 = 201	996 = 202	1429 = 203	399 = 204	305 = 205	4123 = 206	3924 = 207	2642 + e.k4138 + (e.k2384
1860 = 208	1596 = 209	2699 = 210	3420 = 211	1892 = 212	3770 = 213	570 = 214	4341 = 215	3893 = 216	3546 = 217	3534 = 218	551 = 219	2709 = 220	3193 + e.k359 + (e.k4870
4847 = 221	3160 = 222	228 = 223	3524 = 224	1600 = 225	3722 = 226	1475 = 227	3721 = 228	1691 = 229	2073 = 230	3191 = 231	2311 = 232	96 = 233	3841 + e.k4020 + (e.k670
2620 = 234	1329 = 235	1303 = 236	3306 = 237	477 = 238	1929 = 239	3255 = 240	1746 = 241	32 = 242	2142 = 243	2753 = 244	3895 = 245	2931 = 246	726 + e.k913 + (e.k3244
2719 = 247	3426 = 248	2207 = 249	129 = 250	1126 = 251	163 = 252	2618 = 253	683 = 254	615 = 255	2078 = 256	279 = 257	4144 = 258	423 = 259	399 + e.k1691 + (e.k2928`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e48 = fill48(born());
function fill49(e) {`,
      [
        `1015 = 0	2210 = 1	3224 = 2	647 = 3	3582 = 4	1607 = 5	1528 = 6	333 = 7	1633 = 8	2419 = 9	4348 = 10	2393 = 11	2095 = 12	2393 + e.k647 + (e.k3755
4479 = 13	3531 = 14	2834 = 15	2681 = 16	1791 = 17	1739 = 18	215 = 19	3324 = 20	1686 = 21	1881 = 22	459 = 23	2501 = 24	4661 = 25	647 + e.k1686 + (e.k50
4372 = 26	4520 = 27	4690 = 28	200 = 29	356 = 30	2786 = 31	978 = 32	4082 = 33	2159 = 34	1374 = 35	3753 = 36	3348 = 37	1294 = 38	1528 + e.k4082 + (e.k1238
4906 = 39	1377 = 40	996 = 41	3538 = 42	1611 = 43	4810 = 44	4128 = 45	513 = 46	1663 = 47	2126 = 48	1121 = 49	4398 = 50	146 = 51	4128 + e.k1739 + (e.k4114
1388 = 52	4762 = 53	4951 = 54	2235 = 55	4753 = 56	3822 = 57	2140 = 58	2125 = 59	1110 = 60	3300 = 61	3216 = 62	2716 = 63	1381 = 64	2716 + e.k215 + (e.k331
3349 = 65	4656 = 66	2869 = 67	3933 = 68	3075 = 69	2277 = 70	2434 = 71	930 = 72	2704 = 73	4809 = 74	763 = 75	2918 = 76	590 = 77	2681 + e.k2786 + (e.k2113
1601 = 78	1814 = 79	2535 = 80	764 = 81	3329 = 82	139 = 83	4187 = 84	1923 = 85	449 = 86	1414 = 87	1812 = 88	3614 = 89	300 = 90	1607 + e.k459 + (e.k534
1405 = 91	2793 = 92	2177 = 93	2119 = 94	25 = 95	3414 = 96	3350 = 97	4376 = 98	3936 = 99	2064 = 100	4220 = 101	1775 = 102	3946 = 103	2793 + e.k4809 + (e.k1452
3606 = 104	3140 = 105	4200 = 106	372 = 107	1094 = 108	214 = 109	4839 = 110	4370 = 111	2181 = 112	2390 = 113	4092 = 114	3002 = 115	4310 = 116	1094 + e.k449 + (e.k4743
1543 = 117	2772 = 118	2843 = 119	3118 = 120	695 = 121	2908 = 122	729 = 123	771 = 124	3204 = 125	1986 = 126	2757 = 127	3906 = 128	3650 = 129	1986 + e.k3582 + (e.k2994
4783 = 130	4037 = 131	690 = 132	1292 = 133	2479 = 134	3167 = 135	2797 = 136	265 = 137	2058 = 138	3284 = 139	4333 = 140	1640 = 141	2221 = 142	1686 + e.k2479 + (e.k2058
366 = 143	2672 = 144	1722 = 145	115 = 146	2385 = 147	2723 = 148	425 = 149	4277 = 150	369 = 151	456 = 152	1689 = 153	657 = 154	4434 = 155	369 + e.k2277 + (e.k589
1025 = 156	1532 = 157	4063 = 158	1104 = 159	4163 = 160	950 = 161	2440 = 162	3642 = 163	3482 = 164	322 = 165	2348 = 166	1598 = 167	1341 = 168	4753 + e.k4277 + (e.k290
1490 = 169	2617 = 170	317 = 171	250 = 172	1259 = 173	796 = 174	830 = 175	295 = 176	1269 = 177	756 = 178	2799 = 179	3926 = 180	392 = 181	139 + e.k4348 + (e.k1316
4140 = 182	4362 = 183	1822 = 184	1702 = 185	2430 = 186	2090 = 187	4205 = 188	809 = 189	2951 = 190	2009 = 191	2683 = 192	4180 = 193	4716 = 194	2058 + e.k3204 + (e.k3792
1014 = 195	1109 = 196	2236 = 197	4989 = 198	1433 = 199	1230 = 200	244 = 201	3237 = 202	2007 = 203	995 = 204	2746 = 205	2111 = 206	1280 = 207	3284 + e.k2235 + (e.k4284
4289 = 208	291 = 209	4887 = 210	3212 = 211	432 = 212	3181 = 213	247 = 214	3716 = 215	1389 = 216	2794 = 217	1218 = 218	1749 = 219	4365 = 220	1414 + e.k2797 + (e.k1866
324 = 221	4671 = 222	598 = 223	1485 = 224	3470 = 225	532 = 226	2849 = 227	1379 = 228	4747 = 229	1952 = 230	1353 = 231	607 = 232	2956 = 233	4362 + e.k425 + (e.k2781
1636 = 234	1612 = 235	2073 = 236	3283 = 237	3434 = 238	1454 = 239	4556 = 240	4934 = 241	1859 = 242	1479 = 243	1573 = 244	4138 = 245	849 = 246	2746 + e.k4398 + (e.k1848
441 = 247	772 = 248	354 = 249	3882 = 250	2107 = 251	4305 = 252	1019 = 253	1692 = 254	1985 = 255	3812 = 256	2607 = 257	4343 = 258	3530 = 259	317 + e.k3614 + (e.k1396`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e49 = fill49(born());
function fill50(e) {`,
      [
        `910 = 0	3147 = 1	4307 = 2	1655 = 3	134 = 4	1485 = 5	2559 = 6	3880 = 7	3667 = 8	4376 = 9	2285 = 10	1820 = 11	139 = 12	3667 + e.k1485 + (e.k2372
2613 = 13	1974 = 14	256 = 15	243 = 16	538 = 17	1979 = 18	4885 = 19	4621 = 20	3839 = 21	2757 = 22	2563 = 23	1949 = 24	640 = 25	538 + e.k1979 + (e.k3365
3494 = 26	1033 = 27	2250 = 28	3526 = 29	2618 = 30	4939 = 31	154 = 32	2109 = 33	4475 = 34	2032 = 35	473 = 36	4657 = 37	3790 = 38	134 + e.k2032 + (e.k3141
3426 = 39	1483 = 40	2476 = 41	4903 = 42	1671 = 43	3842 = 44	2221 = 45	4422 = 46	4057 = 47	4703 = 48	4886 = 49	3247 = 50	693 = 51	2757 + e.k139 + (e.k2943
1200 = 52	2533 = 53	792 = 54	3798 = 55	3633 = 56	525 = 57	408 = 58	3730 = 59	1176 = 60	4660 = 61	2988 = 62	1881 = 63	2192 = 64	1176 + e.k3880 + (e.k26
1660 = 65	842 = 66	176 = 67	4790 = 68	4388 = 69	4898 = 70	1271 = 71	2274 = 72	3690 = 73	780 = 74	231 = 75	3897 = 76	2170 = 77	842 + e.k780 + (e.k2521
4968 = 78	1535 = 79	1800 = 80	2144 = 81	2543 = 82	205 = 83	4090 = 84	3890 = 85	4289 = 86	1624 = 87	2334 = 88	1454 = 89	3992 = 90	2144 + e.k1624 + (e.k768
2257 = 91	2176 = 92	1 = 93	990 = 94	3452 = 95	2216 = 96	1077 = 97	4853 = 98	4999 = 99	3470 = 100	1677 = 101	4585 = 102	472 = 103	3147 + e.k2274 + (e.k2961
1670 = 104	1503 = 105	1968 = 106	3214 = 107	1704 = 108	3266 = 109	4627 = 110	456 = 111	2791 = 112	2413 = 113	4786 = 114	3134 = 115	343 = 116	3470 + e.k3667 + (e.k2310
1956 = 117	4656 = 118	980 = 119	4972 = 120	711 = 121	679 = 122	4365 = 123	4522 = 124	2432 = 125	2681 = 126	4092 = 127	12 = 128	2823 = 129	2757 + e.k2285 + (e.k641
2976 = 130	904 = 131	2134 = 132	383 = 133	1886 = 134	1596 = 135	4305 = 136	3540 = 137	1378 = 138	1834 = 139	1757 = 140	1847 = 141	386 = 142	134 + e.k3790 + (e.k3135
2999 = 143	2518 = 144	702 = 145	284 = 146	4240 = 147	619 = 148	3579 = 149	283 = 150	2312 = 151	2947 = 152	4607 = 153	3738 = 154	3655 = 155	3690 + e.k2134 + (e.k4661
3390 = 156	2000 = 157	4622 = 158	1686 = 159	1050 = 160	2427 = 161	1037 = 162	1448 = 163	3246 = 164	2478 = 165	4895 = 166	3368 = 167	3609 = 168	2000 + e.k4903 + (e.k3839
1138 = 169	2886 = 170	2555 = 171	764 = 172	970 = 173	1058 = 174	3665 = 175	3993 = 176	1187 = 177	1085 = 178	3936 = 179	39 = 180	3142 = 181	2216 + e.k256 + (e.k1576
2833 = 182	1119 = 183	4426 = 184	4306 = 185	335 = 186	4946 = 187	724 = 188	1046 = 189	3674 = 190	1752 = 191	4239 = 192	458 = 193	241 = 194	472 + e.k1686 + (e.k1939
4439 = 195	2058 = 196	668 = 197	1490 = 198	7 = 199	353 = 200	3000 = 201	1745 = 202	3271 = 203	1381 = 204	863 = 205	903 = 206	4411 = 207	903 + e.k4622 + (e.k3524
43 = 208	3800 = 209	1908 = 210	201 = 211	1615 = 212	1854 = 213	4567 = 214	2934 = 215	157 = 216	2346 = 217	322 = 218	242 = 219	117 = 220	1077 + e.k322 + (e.k3510
111 = 221	4091 = 222	4665 = 223	666 = 224	3150 = 225	4889 = 226	4906 = 227	2225 = 228	3226 = 229	3610 = 230	962 = 231	4097 = 232	4553 = 233	353 + e.k990 + (e.k445
707 = 234	1097 = 235	219 = 236	3408 = 237	2060 = 238	1733 = 239	153 = 240	1893 = 241	1290 = 242	1282 = 243	324 = 244	4058 = 245	2057 = 246	2432 + e.k1050 + (e.k91
2715 = 247	4225 = 248	4449 = 249	1611 = 250	2305 = 251	229 = 252	2954 = 253	4195 = 254	3445 = 255	2097 = 256	2878 = 257	3547 = 258	4010 = 259	2518 + e.k1704 + (e.k4740`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e50 = fill50(born());
function fill51(e) {`,
      [
        `1419 = 0	1154 = 1	3950 = 2	288 = 3	4128 = 4	3383 = 5	2926 = 6	4996 = 7	3432 = 8	3412 = 9	1836 = 10	1192 = 11	785 = 12	3412 + e.k1154 + (e.k3733
1532 = 13	1741 = 14	2799 = 15	2028 = 16	3381 = 17	1317 = 18	2697 = 19	4490 = 20	3526 = 21	3453 = 22	3083 = 23	3743 = 24	728 = 25	4490 + e.k3453 + (e.k3477
221 = 26	3694 = 27	250 = 28	2181 = 29	3277 = 30	3856 = 31	1210 = 32	972 = 33	4307 = 34	1279 = 35	1308 = 36	3600 = 37	4983 = 38	3381 + e.k221 + (e.k2602
3139 = 39	2535 = 40	2230 = 41	2927 = 42	4446 = 43	3164 = 44	1354 = 45	3646 = 46	927 = 47	2985 = 48	1446 = 49	4016 = 50	3304 = 51	3277 + e.k1192 + (e.k3726
415 = 52	795 = 53	2570 = 54	2600 = 55	3545 = 56	2786 = 57	991 = 58	1381 = 59	2217 = 60	4141 = 61	1616 = 62	1620 = 63	2883 = 64	3383 + e.k1354 + (e.k4290
2712 = 65	363 = 66	1824 = 67	919 = 68	932 = 69	1969 = 70	909 = 71	3018 = 72	4241 = 73	3901 = 74	3786 = 75	4308 = 76	3812 = 77	3950 + e.k3412 + (e.k4595
2740 = 78	2919 = 79	1928 = 80	4207 = 81	3359 = 82	3749 = 83	3525 = 84	489 = 85	4441 = 86	726 = 87	2605 = 88	417 = 89	3058 = 90	1532 + e.k4308 + (e.k3311
2981 = 91	505 = 92	4484 = 93	3572 = 94	189 = 95	432 = 96	2224 = 97	484 = 98	664 = 99	4006 = 100	3782 = 101	3723 = 102	147 = 103	4128 + e.k3526 + (e.k627
4279 = 104	3481 = 105	4919 = 106	4844 = 107	4672 = 108	4620 = 109	3477 = 110	2300 = 111	4100 = 112	3992 = 113	4990 = 114	3822 = 115	2140 = 116	3383 + e.k3901 + (e.k3687
2448 = 117	1227 = 118	2920 = 119	319 = 120	1508 = 121	4848 = 122	686 = 123	4050 = 124	2756 = 125	3389 = 126	2596 = 127	4585 = 128	818 = 129	2883 + e.k1210 + (e.k3887
2034 = 130	1876 = 131	2711 = 132	12 = 133	1904 = 134	952 = 135	3184 = 136	1483 = 137	405 = 138	1921 = 139	1199 = 140	3076 = 141	591 = 142	189 + e.k2919 + (e.k4815
4999 = 143	3726 = 144	2465 = 145	4174 = 146	2508 = 147	3017 = 148	1663 = 149	1021 = 150	2328 = 151	1098 = 152	4254 = 153	488 = 154	3559 = 155	2740 + e.k1620 + (e.k3057
2278 = 156	4685 = 157	1846 = 158	3603 = 159	4768 = 160	1674 = 161	4652 = 162	4162 = 163	2460 = 164	1345 = 165	3828 = 166	3253 = 167	2554 = 168	1969 + e.k2278 + (e.k4493
4924 = 169	3254 = 170	2287 = 171	2246 = 172	2208 = 173	456 = 174	916 = 175	2682 = 176	4830 = 177	2829 = 178	429 = 179	1634 = 180	1347 = 181	1969 + e.k2981 + (e.k2888
3280 = 182	1801 = 183	2952 = 184	1571 = 185	928 = 186	1386 = 187	3300 = 188	1702 = 189	3439 = 190	2514 = 191	871 = 192	4137 = 193	4802 = 194	1824 + e.k1227 + (e.k4450
3005 = 195	3215 = 196	1161 = 197	4658 = 198	1086 = 199	540 = 200	2569 = 201	1649 = 202	1283 = 203	4198 = 204	246 = 205	2659 = 206	1816 = 207	4174 + e.k3017 + (e.k78
4635 = 208	4314 = 209	1394 = 210	1396 = 211	4438 = 212	2539 = 213	527 = 214	3334 = 215	4325 = 216	827 = 217	298 = 218	162 = 219	2085 = 220	686 + e.k3481 + (e.k4268
2847 = 221	1174 = 222	4920 = 223	3380 = 224	1424 = 225	4310 = 226	1764 = 227	462 = 228	235 = 229	1484 = 230	3860 = 231	1132 = 232	1872 = 233	3812 + e.k2659 + (e.k526
4212 = 234	2783 = 235	2628 = 236	1010 = 237	4993 = 238	4380 = 239	490 = 240	74 = 241	4608 = 242	2331 = 243	3457 = 244	930 = 245	597 = 246	4919 + e.k3017 + (e.k1637
823 = 247	4570 = 248	2205 = 249	2675 = 250	1215 = 251	1364 = 252	4879 = 253	4846 = 254	3750 = 255	1596 = 256	317 = 257	4440 = 258	1406 = 259	4484 + e.k3481 + (e.k2323`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e51 = fill51(born());
function fill52(e) {`,
      [
        `334 = 0	2270 = 1	3425 = 2	1634 = 3	3836 = 4	537 = 5	1089 = 6	3212 = 7	1606 = 8	3567 = 9	1693 = 10	3289 = 11	3232 = 12	537 + e.k1634 + (e.k2073
4582 = 13	1851 = 14	2747 = 15	2901 = 16	2867 = 17	3716 = 18	3253 = 19	2469 = 20	2123 = 21	357 = 22	808 = 23	2710 = 24	1967 = 25	1089 + e.k1606 + (e.k818
1598 = 26	955 = 27	3663 = 28	3453 = 29	2730 = 30	3027 = 31	2589 = 32	4346 = 33	2143 = 34	3176 = 35	3354 = 36	1020 = 37	3944 = 38	3027 + e.k3253 + (e.k2392
4497 = 39	4624 = 40	3852 = 41	1004 = 42	328 = 43	617 = 44	3850 = 45	2969 = 46	236 = 47	642 = 48	1681 = 49	3603 = 50	3243 = 51	2969 + e.k3567 + (e.k1160
648 = 52	2903 = 53	1256 = 54	3266 = 55	2983 = 56	3238 = 57	3214 = 58	3272 = 59	2380 = 60	4738 = 61	4316 = 62	3198 = 63	1795 = 64	328 + e.k357 + (e.k2602
958 = 65	3413 = 66	535 = 67	475 = 68	2396 = 69	4997 = 70	1607 = 71	746 = 72	3963 = 73	813 = 74	4075 = 75	707 = 76	3362 = 77	3453 + e.k1693 + (e.k4001
1845 = 78	4009 = 79	1688 = 80	4102 = 81	168 = 82	4809 = 83	3863 = 84	857 = 85	4122 = 86	2868 = 87	4511 = 88	463 = 89	622 = 90	617 + e.k2589 + (e.k104
827 = 91	3706 = 92	1798 = 93	3349 = 94	1493 = 95	529 = 96	4422 = 97	2274 = 98	2503 = 99	2064 = 100	1980 = 101	3548 = 102	2866 = 103	1493 + e.k2983 + (e.k2994
3887 = 104	2067 = 105	2483 = 106	1572 = 107	1295 = 108	654 = 109	2880 = 110	3894 = 111	330 = 112	75 = 113	879 = 114	4402 = 115	4998 = 116	1572 + e.k3232 + (e.k3393
2649 = 117	1627 = 118	286 = 119	1228 = 120	549 = 121	1286 = 122	4013 = 123	2043 = 124	4555 = 125	560 = 126	2659 = 127	3601 = 128	3264 = 129	1004 + e.k2396 + (e.k431
3740 = 130	4895 = 131	4092 = 132	4785 = 133	4318 = 134	365 = 135	190 = 136	3621 = 137	342 = 138	3502 = 139	3892 = 140	4678 = 141	2918 = 142	2270 + e.k2123 + (e.k1357
523 = 143	4908 = 144	902 = 145	2841 = 146	2053 = 147	3088 = 148	3933 = 149	669 = 150	4837 = 151	2438 = 152	1996 = 153	3704 = 154	3304 = 155	3413 + e.k4013 + (e.k4217
2660 = 156	1926 = 157	1913 = 158	1562 = 159	3815 = 160	4085 = 161	404 = 162	2485 = 163	1318 = 164	4681 = 165	2427 = 166	3981 = 167	4974 = 168	365 + e.k1228 + (e.k4744
4184 = 169	128 = 170	205 = 171	2408 = 172	3760 = 173	2353 = 174	1511 = 175	3390 = 176	4276 = 177	149 = 178	2858 = 179	308 = 180	359 = 181	2270 + e.k2396 + (e.k3017
4918 = 182	2757 = 183	3220 = 184	1491 = 185	2759 = 186	3141 = 187	4967 = 188	4635 = 189	1428 = 190	3889 = 191	984 = 192	3312 = 193	4319 = 194	2867 + e.k4184 + (e.k1446
1677 = 195	4088 = 196	837 = 197	66 = 198	2313 = 199	3079 = 200	3627 = 201	700 = 202	4870 = 203	4037 = 204	2220 = 205	747 = 206	1599 = 207	236 + e.k3214 + (e.k4280
1673 = 208	3847 = 209	4140 = 210	3000 = 211	1209 = 212	4791 = 213	4636 = 214	354 = 215	1852 = 216	512 = 217	2275 = 218	2506 = 219	2412 = 220	3349 + e.k3852 + (e.k4154
4259 = 221	4660 = 222	3550 = 223	3314 = 224	621 = 225	396 = 226	3766 = 227	3948 = 228	1030 = 229	3436 = 230	1147 = 231	55 = 232	1998 = 233	2143 + e.k3894 + (e.k272
2433 = 234	1236 = 235	1134 = 236	3053 = 237	3676 = 238	391 = 239	4717 = 240	414 = 241	3899 = 242	1847 = 243	3161 = 244	1904 = 245	3801 = 246	357 + e.k529 + (e.k1166
4130 = 247	4349 = 248	2342 = 249	2013 = 250	3006 = 251	553 = 252	3392 = 253	2597 = 254	2855 = 255	210 = 256	3175 = 257	2376 = 258	1635 = 259	1913 + e.k4974 + (e.k3718`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e52 = fill52(born());
function fill53(e) {`,
      [
        `1123 = 0	2748 = 1	462 = 2	2744 = 3	1383 = 4	4291 = 5	2984 = 6	983 = 7	1939 = 8	1182 = 9	3983 = 10	1930 = 11	3600 = 12	983 + e.k2748 + (e.k1755
1240 = 13	1447 = 14	1102 = 15	1879 = 16	215 = 17	3963 = 18	3747 = 19	885 = 20	1581 = 21	899 = 22	792 = 23	1436 = 24	2585 = 25	1581 + e.k885 + (e.k793
2881 = 26	4844 = 27	1168 = 28	4398 = 29	3157 = 30	517 = 31	3373 = 32	326 = 33	2886 = 34	2808 = 35	2660 = 36	2226 = 37	2180 = 38	2748 + e.k899 + (e.k1369
2864 = 39	3814 = 40	947 = 41	2675 = 42	4733 = 43	4053 = 44	2097 = 45	1052 = 46	3120 = 47	4579 = 48	4305 = 49	3727 = 50	1801 = 51	3120 + e.k3963 + (e.k2874
3767 = 52	1478 = 53	1225 = 54	831 = 55	2334 = 56	1351 = 57	3078 = 58	484 = 59	2820 = 60	26 = 61	2741 = 62	4062 = 63	3328 = 64	3727 + e.k3983 + (e.k696
3645 = 65	2422 = 66	4570 = 67	1044 = 68	4236 = 69	3102 = 70	1639 = 71	1149 = 72	4636 = 73	9 = 74	4175 = 75	2553 = 76	1636 = 77	462 + e.k2886 + (e.k179
4441 = 78	2349 = 79	1306 = 80	4216 = 81	1905 = 82	1641 = 83	438 = 84	2238 = 85	1821 = 86	121 = 87	2446 = 88	4987 = 89	711 = 90	1581 + e.k2881 + (e.k2015
877 = 91	3189 = 92	4375 = 93	1106 = 94	1600 = 95	4612 = 96	927 = 97	1394 = 98	1679 = 99	1505 = 100	3659 = 101	4415 = 102	1357 = 103	4398 + e.k792 + (e.k2253
3894 = 104	3992 = 105	4819 = 106	826 = 107	2042 = 108	808 = 109	4764 = 110	3070 = 111	291 = 112	4780 = 113	990 = 114	1446 = 115	4856 = 116	2675 + e.k1636 + (e.k1364
1830 = 117	1254 = 118	3288 = 119	2587 = 120	2870 = 121	3137 = 122	3322 = 123	1634 = 124	3989 = 125	3269 = 126	1359 = 127	2031 = 128	712 = 129	3078 + e.k1383 + (e.k2177
4830 = 130	340 = 131	31 = 132	311 = 133	4211 = 134	1654 = 135	4742 = 136	2146 = 137	1778 = 138	2945 = 139	1957 = 140	3220 = 141	2431 = 142	2349 + e.k2146 + (e.k256
3632 = 143	3051 = 144	3009 = 145	3258 = 146	1667 = 147	3036 = 148	152 = 149	1487 = 150	189 = 151	2889 = 152	2486 = 153	4508 = 154	4410 = 155	885 + e.k3009 + (e.k3965
886 = 156	1455 = 157	2890 = 158	2805 = 159	3360 = 160	3431 = 161	722 = 162	4385 = 163	4312 = 164	996 = 165	1297 = 166	3497 = 167	371 = 168	2585 + e.k4415 + (e.k1896
4309 = 169	546 = 170	3934 = 171	2290 = 172	4863 = 173	3232 = 174	4784 = 175	1915 = 176	1205 = 177	3714 = 178	1845 = 179	1041 = 180	1551 = 181	1581 + e.k1447 + (e.k2049
4313 = 182	1829 = 183	2223 = 184	1508 = 185	1305 = 186	1866 = 187	2420 = 188	4669 = 189	1413 = 190	3123 = 191	93 = 192	798 = 193	3589 = 194	1413 + e.k2097 + (e.k1088
4163 = 195	4055 = 196	3421 = 197	2388 = 198	3936 = 199	2804 = 200	2265 = 201	34 = 202	1503 = 203	1929 = 204	503 = 205	2381 = 206	2878 = 207	2870 + e.k3322 + (e.k1201
3885 = 208	1010 = 209	1573 = 210	68 = 211	4805 = 212	4915 = 213	954 = 214	896 = 215	3451 = 216	3299 = 217	1736 = 218	2766 = 219	4486 = 220	152 + e.k1600 + (e.k2949
4217 = 221	4303 = 222	1135 = 223	3725 = 224	803 = 225	1768 = 226	4851 = 227	4432 = 228	2165 = 229	247 = 230	2755 = 231	4739 = 232	2230 = 233	2334 + e.k1106 + (e.k991
2694 = 234	3465 = 235	4458 = 236	2078 = 237	4026 = 238	3196 = 239	4182 = 240	3182 = 241	4119 = 242	4521 = 243	2153 = 244	4328 = 245	78 = 246	4432 + e.k1600 + (e.k4574
4316 = 247	3705 = 248	3897 = 249	1175 = 250	3744 = 251	1942 = 252	839 = 253	3347 = 254	3153 = 255	1806 = 256	1510 = 257	451 = 258	701 = 259	1641 + e.k3645 + (e.k1057`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e53 = fill53(born());
function fill54(e) {`,
      [
        `2246 = 0	1604 = 1	1844 = 2	1935 = 3	4252 = 4	3728 = 5	1358 = 6	1731 = 7	1508 = 8	841 = 9	2746 = 10	2126 = 11	1078 = 12	2746 + e.k1844 + (e.k3719
655 = 13	3665 = 14	3329 = 15	3474 = 16	1291 = 17	4726 = 18	3129 = 19	411 = 20	3808 = 21	1169 = 22	592 = 23	923 = 24	3910 = 25	1844 + e.k592 + (e.k1471
388 = 26	2358 = 27	2188 = 28	4091 = 29	1969 = 30	3569 = 31	2282 = 32	4841 = 33	572 = 34	372 = 35	2400 = 36	2034 = 37	4351 = 38	655 + e.k2358 + (e.k2978
2927 = 39	158 = 40	3502 = 41	4639 = 42	2449 = 43	3454 = 44	3120 = 45	198 = 46	700 = 47	427 = 48	4286 = 49	2699 = 50	3574 = 51	4286 + e.k4639 + (e.k3971
4724 = 52	2581 = 53	2280 = 54	1903 = 55	4848 = 56	98 = 57	498 = 58	2114 = 59	1104 = 60	4090 = 61	1316 = 62	3475 = 63	2640 = 64	655 + e.k1604 + (e.k2425
2462 = 65	3093 = 66	1231 = 67	2515 = 68	3828 = 69	843 = 70	2751 = 71	2189 = 72	3935 = 73	2920 = 74	2444 = 75	3504 = 76	1585 = 77	2927 + e.k4848 + (e.k2451
2346 = 78	1551 = 79	3001 = 80	4587 = 81	3683 = 82	3217 = 83	3022 = 84	819 = 85	1661 = 86	2889 = 87	4659 = 88	1126 = 89	3157 = 90	4286 + e.k3728 + (e.k3974
4737 = 91	1467 = 92	2616 = 93	1463 = 94	3863 = 95	3601 = 96	1417 = 97	2465 = 98	2630 = 99	4853 = 100	3870 = 101	437 = 102	1589 = 103	1589 + e.k3504 + (e.k2753
1308 = 104	2558 = 105	4527 = 106	533 = 107	1258 = 108	4427 = 109	3734 = 110	2176 = 111	2110 = 112	1695 = 113	3268 = 114	661 = 115	1401 = 116	923 + e.k4639 + (e.k575
632 = 117	3002 = 118	493 = 119	2810 = 120	2819 = 121	2056 = 122	1051 = 123	1738 = 124	1660 = 125	2293 = 126	4895 = 127	1808 = 128	4265 = 129	1969 + e.k3863 + (e.k511
1454 = 130	1371 = 131	2168 = 132	1323 = 133	2790 = 134	764 = 135	3697 = 136	4725 = 137	4627 = 138	782 = 139	4562 = 140	1809 = 141	518 = 142	3001 + e.k3665 + (e.k1026
3988 = 143	2825 = 144	3712 = 145	3933 = 146	2435 = 147	4027 = 148	490 = 149	4876 = 150	2614 = 151	4790 = 152	4719 = 153	1099 = 154	1253 = 155	1454 + e.k2126 + (e.k4348
1436 = 156	2881 = 157	4800 = 158	3 = 159	4623 = 160	3842 = 161	3607 = 162	4228 = 163	4391 = 164	223 = 165	2475 = 166	1057 = 167	1562 = 168	2614 + e.k1316 + (e.k419
695 = 169	4098 = 170	1530 = 171	1555 = 172	3408 = 173	2409 = 174	2090 = 175	4829 = 176	3671 = 177	1647 = 178	1595 = 179	294 = 180	3782 = 181	4391 + e.k4091 + (e.k703
1528 = 182	3866 = 183	2548 = 184	1357 = 185	4838 = 186	1433 = 187	4408 = 188	1529 = 189	3384 = 190	1452 = 191	2079 = 192	3519 = 193	711 = 194	4527 + e.k1969 + (e.k379
582 = 195	2479 = 196	3225 = 197	1686 = 198	4577 = 199	4363 = 200	3633 = 201	4529 = 202	3703 = 203	1700 = 204	2083 = 205	229 = 206	4513 = 207	229 + e.k2110 + (e.k4874
2648 = 208	791 = 209	1127 = 210	383 = 211	3325 = 212	2786 = 213	350 = 214	1053 = 215	3444 = 216	1786 = 217	583 = 218	4542 = 219	1943 = 220	3870 + e.k3808 + (e.k1666
321 = 221	1313 = 222	363 = 223	4913 = 224	3013 = 225	3333 = 226	1398 = 227	2724 = 228	648 = 229	3681 = 230	1584 = 231	2716 = 232	4495 = 233	4627 + e.k1555 + (e.k2892
1112 = 234	418 = 235	3612 = 236	4387 = 237	2990 = 238	3674 = 239	1541 = 240	2089 = 241	3012 = 242	4528 = 243	547 = 244	1549 = 245	1846 = 246	3633 + e.k2581 + (e.k3922
2509 = 247	2817 = 248	3789 = 249	4374 = 250	4031 = 251	4083 = 252	3927 = 253	4360 = 254	1008 = 255	3940 = 256	1843 = 257	3413 = 258	4455 = 259	3789 + e.k3329 + (e.k525`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e54 = fill54(born());
function fill55(e) {`,
      [
        `3248 = 0	2195 = 1	3240 = 2	2194 = 3	2587 = 4	625 = 5	4373 = 6	2019 = 7	3581 = 8	914 = 9	3273 = 10	4555 = 11	4959 = 12	2195 + e.k2194 + (e.k2496
2175 = 13	2347 = 14	2606 = 15	3069 = 16	592 = 17	3122 = 18	2188 = 19	2986 = 20	4388 = 21	2088 = 22	3376 = 23	3166 = 24	138 = 25	4373 + e.k625 + (e.k1905
898 = 26	2644 = 27	3278 = 28	2616 = 29	467 = 30	4527 = 31	3001 = 32	3160 = 33	1158 = 34	4637 = 35	760 = 36	4359 = 37	2159 = 38	4373 + e.k2347 + (e.k4755
643 = 39	2520 = 40	769 = 41	4053 = 42	4963 = 43	2669 = 44	2944 = 45	228 = 46	4946 = 47	3875 = 48	3068 = 49	1346 = 50	2406 = 51	2669 + e.k4527 + (e.k788
4855 = 52	4284 = 53	3960 = 54	4979 = 55	691 = 56	4458 = 57	758 = 58	4014 = 59	1187 = 60	1329 = 61	1217 = 62	68 = 63	3641 = 64	760 + e.k898 + (e.k1634
3104 = 65	4857 = 66	2958 = 67	3176 = 68	3465 = 69	2688 = 70	2715 = 71	16 = 72	479 = 73	4212 = 74	1145 = 75	2939 = 76	3477 = 77	68 + e.k2958 + (e.k2777
1390 = 78	707 = 79	4078 = 80	1739 = 81	3822 = 82	3934 = 83	1504 = 84	381 = 85	2963 = 86	410 = 87	4202 = 88	1695 = 89	713 = 90	228 + e.k68 + (e.k4033
2224 = 91	2284 = 92	4739 = 93	4821 = 94	3004 = 95	245 = 96	2265 = 97	1684 = 98	3295 = 99	1380 = 100	3384 = 101	1409 = 102	1485 = 103	1739 + e.k3376 + (e.k4907
2841 = 104	1218 = 105	3828 = 106	831 = 107	1615 = 108	4256 = 109	3579 = 110	160 = 111	1973 = 112	1062 = 113	2386 = 114	3215 = 115	2418 = 116	2159 + e.k16 + (e.k884
1627 = 117	4748 = 118	3432 = 119	2546 = 120	2874 = 121	3033 = 122	4215 = 123	109 = 124	1894 = 125	4280 = 126	956 = 127	605 = 128	1028 = 129	3960 + e.k707 + (e.k1662
1461 = 130	847 = 131	2021 = 132	1629 = 133	3458 = 134	3159 = 135	248 = 136	1333 = 137	1762 = 138	836 = 139	3704 = 140	3059 = 141	1304 = 142	4857 + e.k3215 + (e.k225
4985 = 143	4535 = 144	4931 = 145	944 = 146	2472 = 147	4771 = 148	403 = 149	2873 = 150	1186 = 151	2079 = 152	4643 = 153	1781 = 154	351 = 155	3376 + e.k625 + (e.k4023
1407 = 156	1194 = 157	1833 = 158	3539 = 159	1003 = 160	1516 = 161	431 = 162	2657 = 163	4898 = 164	4889 = 165	4047 = 166	3015 = 167	453 = 168	1627 + e.k3159 + (e.k3953
2456 = 169	4807 = 170	811 = 171	4995 = 172	3794 = 173	702 = 174	298 = 175	2950 = 176	3420 = 177	3622 = 178	1324 = 179	1308 = 180	1278 = 181	3794 + e.k1346 + (e.k2196
2729 = 182	4247 = 183	460 = 184	2177 = 185	225 = 186	575 = 187	2264 = 188	170 = 189	3373 = 190	3082 = 191	3287 = 192	3724 = 193	4728 = 194	836 + e.k3295 + (e.k1931
3576 = 195	1859 = 196	615 = 197	4502 = 198	3476 = 199	3922 = 200	3250 = 201	2206 = 202	2373 = 203	4410 = 204	796 = 205	2379 = 206	3688 = 207	702 + e.k479 + (e.k1112
4207 = 208	108 = 209	2328 = 210	2366 = 211	2878 = 212	172 = 213	990 = 214	772 = 215	2718 = 216	4177 = 217	2322 = 218	2145 = 219	3293 = 220	3960 + e.k2406 + (e.k9
3354 = 221	2854 = 222	1126 = 223	3116 = 224	389 = 225	936 = 226	128 = 227	305 = 228	1121 = 229	1989 = 230	1214 = 231	494 = 232	4401 = 233	3059 + e.k3104 + (e.k769
2407 = 234	1279 = 235	828 = 236	1247 = 237	1792 = 238	2108 = 239	4578 = 240	1863 = 241	2212 = 242	1851 = 243	2917 = 244	574 = 245	1305 = 246	944 + e.k389 + (e.k2129
4633 = 247	3765 = 248	1150 = 249	1443 = 250	2535 = 251	1866 = 252	4849 = 253	3217 = 254	1053 = 255	2075 = 256	1927 = 257	4156 = 258	2761 = 259	3159 + e.k2841 + (e.k1764`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e55 = fill55(born());
function fill56(e) {`,
      [
        `4859 = 0	557 = 1	1896 = 2	2680 = 3	1150 = 4	570 = 5	1127 = 6	4949 = 7	3672 = 8	2781 = 9	4466 = 10	3136 = 11	4027 = 12	3672 + e.k3672 + (e.k4524
4946 = 13	3592 = 14	338 = 15	16 = 16	4525 = 17	1154 = 18	1178 = 19	732 = 20	2791 = 21	2127 = 22	757 = 23	2843 = 24	363 = 25	3136 + e.k2843 + (e.k412
273 = 26	4883 = 27	1391 = 28	963 = 29	173 = 30	1318 = 31	4899 = 32	2478 = 33	561 = 34	1622 = 35	2024 = 36	2526 = 37	2026 = 38	1391 + e.k1896 + (e.k3560
3430 = 39	4566 = 40	4485 = 41	3761 = 42	66 = 43	2988 = 44	2330 = 45	696 = 46	75 = 47	3665 = 48	3293 = 49	3804 = 50	3147 = 51	1178 + e.k363 + (e.k3459
2673 = 52	3694 = 53	4101 = 54	4943 = 55	180 = 56	3119 = 57	2587 = 58	4496 = 59	4941 = 60	1217 = 61	2399 = 62	4508 = 63	4102 = 64	4883 + e.k4859 + (e.k2271
2916 = 65	3710 = 66	1162 = 67	4288 = 68	2409 = 69	668 = 70	2505 = 71	4051 = 72	4039 = 73	1189 = 74	1180 = 75	579 = 76	3132 = 77	1217 + e.k4525 + (e.k3649
3766 = 78	3729 = 79	2292 = 80	2527 = 81	3113 = 82	1112 = 83	3141 = 84	4853 = 85	669 = 86	2862 = 87	4701 = 88	982 = 89	2028 = 90	2026 + e.k4701 + (e.k2424
220 = 91	2995 = 92	1588 = 93	4811 = 94	4835 = 95	246 = 96	1500 = 97	3760 = 98	184 = 99	678 = 100	4452 = 101	2012 = 102	1938 = 103	4508 + e.k4452 + (e.k1586
3225 = 104	2580 = 105	652 = 106	2094 = 107	323 = 108	8 = 109	2822 = 110	935 = 111	1248 = 112	3951 = 113	4313 = 114	3854 = 115	2349 = 116	1162 + e.k2988 + (e.k4056
3772 = 117	2731 = 118	1656 = 119	1073 = 120	1497 = 121	4445 = 122	4781 = 123	1860 = 124	3187 = 125	1291 = 126	4942 = 127	2958 = 128	4512 = 129	2862 + e.k2958 + (e.k1915
4926 = 130	893 = 131	3189 = 132	540 = 133	833 = 134	3813 = 135	2375 = 136	3533 = 137	1177 = 138	425 = 139	1043 = 140	2665 = 141	4952 = 142	4039 + e.k3189 + (e.k551
3748 = 143	4882 = 144	4237 = 145	304 = 146	3190 = 147	899 = 148	3667 = 149	2990 = 150	355 = 151	1954 = 152	4492 = 153	3359 = 154	3251 = 155	1656 + e.k2527 + (e.k2842
270 = 156	4785 = 157	2913 = 158	2406 = 159	3376 = 160	1416 = 161	2002 = 162	2358 = 163	3819 = 164	2692 = 165	4521 = 166	73 = 167	2262 = 168	3854 + e.k3113 + (e.k2519
1436 = 169	135 = 170	546 = 171	2232 = 172	3406 = 173	3898 = 174	1067 = 175	924 = 176	583 = 177	3805 = 178	3668 = 179	2972 = 180	3042 = 181	1189 + e.k557 + (e.k397
1427 = 182	1221 = 183	4520 = 184	3644 = 185	3426 = 186	3516 = 187	2687 = 188	3758 = 189	1631 = 190	3466 = 191	3997 = 192	4470 = 193	508 = 194	2478 + e.k508 + (e.k3918
881 = 195	2675 = 196	797 = 197	1851 = 198	3240 = 199	4491 = 200	1423 = 201	4605 = 202	904 = 203	4827 = 204	2395 = 205	1439 = 206	2011 = 207	2330 + e.k3466 + (e.k1521
4487 = 208	1021 = 209	3380 = 210	1841 = 211	947 = 212	3446 = 213	3611 = 214	2071 = 215	970 = 216	2410 = 217	2473 = 218	4405 = 219	3959 = 220	4470 + e.k355 + (e.k1061
3786 = 221	2952 = 222	3004 = 223	50 = 224	1265 = 225	3839 = 226	615 = 227	3825 = 228	2231 = 229	1091 = 230	2492 = 231	1782 = 232	2112 = 233	3533 + e.k4313 + (e.k3181
2954 = 234	251 = 235	1066 = 236	4993 = 237	2745 = 238	1279 = 239	985 = 240	4192 = 241	4071 = 242	1287 = 243	1944 = 244	4893 = 245	1996 = 246	668 + e.k3141 + (e.k1936
1381 = 247	4765 = 248	1843 = 249	278 = 250	3624 = 251	120 = 252	217 = 253	2973 = 254	3455 = 255	1441 = 256	809 = 257	2939 = 258	187 = 259	963 + e.k4942 + (e.k3181`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e56 = fill56(born());
function fill57(e) {`,
      [
        `2073 = 0	3116 = 1	4236 = 2	3569 = 3	588 = 4	1901 = 5	2433 = 6	2378 = 7	2590 = 8	1143 = 9	107 = 10	3930 = 11	1305 = 12	3930 + e.k3930 + (e.k4449
2653 = 13	3876 = 14	1336 = 15	817 = 16	681 = 17	2471 = 18	496 = 19	1588 = 20	846 = 21	2720 = 22	4835 = 23	4299 = 24	3319 = 25	2378 + e.k1901 + (e.k691
921 = 26	4919 = 27	1638 = 28	3190 = 29	1001 = 30	2314 = 31	4060 = 32	4900 = 33	4514 = 34	1611 = 35	3055 = 36	0 = 37	1258 = 38	817 + e.k3930 + (e.k4825
2113 = 39	2960 = 40	1168 = 41	2206 = 42	178 = 43	4881 = 44	4297 = 45	652 = 46	467 = 47	3052 = 48	2493 = 49	2251 = 50	3022 = 51	2433 + e.k4297 + (e.k1893
535 = 52	4975 = 53	4414 = 54	2092 = 55	2582 = 56	3864 = 57	3616 = 58	3423 = 59	1362 = 60	562 = 61	2865 = 62	4786 = 63	3523 = 64	4297 + e.k3055 + (e.k3519
201 = 65	1215 = 66	4218 = 67	3964 = 68	3522 = 69	2158 = 70	4403 = 71	3025 = 72	822 = 73	430 = 74	4052 = 75	845 = 76	3210 = 77	430 + e.k3319 + (e.k3536
4390 = 78	2343 = 79	1086 = 80	4096 = 81	2667 = 82	2204 = 83	4595 = 84	1664 = 85	1912 = 86	4459 = 87	210 = 88	2484 = 89	4536 = 90	4060 + e.k3876 + (e.k4696
3473 = 91	4512 = 92	4778 = 93	2249 = 94	677 = 95	2103 = 96	3650 = 97	2684 = 98	4124 = 99	362 = 100	1435 = 101	1332 = 102	2300 = 103	4299 + e.k2653 + (e.k4160
1156 = 104	619 = 105	2462 = 106	4977 = 107	2964 = 108	1960 = 109	3860 = 110	3615 = 111	4541 = 112	160 = 113	4510 = 114	4910 = 115	1019 = 116	3964 + e.k535 + (e.k3819
4262 = 117	4416 = 118	3425 = 119	2123 = 120	951 = 121	1619 = 122	827 = 123	4307 = 124	645 = 125	4553 = 126	4294 = 127	3809 = 128	205 = 129	2113 + e.k3425 + (e.k29
3491 = 130	2349 = 131	1425 = 132	4054 = 133	4731 = 134	4742 = 135	1062 = 136	4398 = 137	431 = 138	4917 = 139	223 = 140	4646 = 141	4688 = 142	2113 + e.k3473 + (e.k3678
4078 = 143	2093 = 144	1070 = 145	785 = 146	2699 = 147	2817 = 148	4621 = 149	1342 = 150	1608 = 151	3883 = 152	2980 = 153	1049 = 154	4274 = 155	785 + e.k3883 + (e.k2303
928 = 156	3745 = 157	4112 = 158	4168 = 159	1474 = 160	3701 = 161	2842 = 162	4463 = 163	1175 = 164	775 = 165	3777 = 166	1361 = 167	4692 = 168	4297 + e.k1168 + (e.k4052
2354 = 169	1185 = 170	3828 = 171	1913 = 172	93 = 173	4852 = 174	1785 = 175	123 = 176	4263 = 177	49 = 178	3580 = 179	3378 = 180	339 = 181	4096 + e.k1362 + (e.k936
3438 = 182	4594 = 183	3979 = 184	1337 = 185	2063 = 186	1154 = 187	2531 = 188	428 = 189	80 = 190	4872 = 191	8 = 192	131 = 193	2922 = 194	4274 + e.k4917 + (e.k2593
1281 = 195	887 = 196	3596 = 197	2560 = 198	2241 = 199	4444 = 200	4720 = 201	3524 = 202	3797 = 203	4155 = 204	627 = 205	1153 = 206	1755 = 207	3025 + e.k4510 + (e.k1623
1487 = 208	745 = 209	335 = 210	4893 = 211	3061 = 212	4748 = 213	1692 = 214	2756 = 215	2006 = 216	4041 = 217	2856 = 218	869 = 219	2340 = 220	4541 + e.k845 + (e.k3724
2831 = 221	3432 = 222	2188 = 223	1423 = 224	2311 = 225	1045 = 226	3997 = 227	3494 = 228	4583 = 229	2680 = 230	355 = 231	3201 = 232	1478 = 233	1086 + e.k4553 + (e.k2454
1937 = 234	623 = 235	893 = 236	1492 = 237	2218 = 238	2515 = 239	1283 = 240	1274 = 241	1141 = 242	1 = 243	275 = 244	4240 = 245	2221 = 246	1913 + e.k535 + (e.k2098
676 = 247	285 = 248	2947 = 249	4846 = 250	2570 = 251	1164 = 252	2759 = 253	3264 = 254	1985 = 255	4651 = 256	1899 = 257	2297 = 258	2617 = 259	1153 + e.k4583 + (e.k4734`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e57 = fill57(born());
function fill58(e) {`,
      [
        `837 = 0	2879 = 1	1081 = 2	3122 = 3	201 = 4	379 = 5	4925 = 6	881 = 7	1569 = 8	1257 = 9	4574 = 10	3607 = 11	19 = 12	4925 + e.k837 + (e.k2123
3074 = 13	2145 = 14	3889 = 15	2552 = 16	1190 = 17	4183 = 18	2828 = 19	2090 = 20	514 = 21	3433 = 22	3461 = 23	2676 = 24	634 = 25	1569 + e.k2879 + (e.k499
2429 = 26	4064 = 27	56 = 28	4522 = 29	1993 = 30	568 = 31	1377 = 32	1017 = 33	4665 = 34	86 = 35	1058 = 36	2194 = 37	2591 = 38	4925 + e.k2591 + (e.k4404
4016 = 39	263 = 40	910 = 41	1456 = 42	1055 = 43	4166 = 44	1308 = 45	1535 = 46	569 = 47	2711 = 48	2883 = 49	515 = 50	3275 = 51	2711 + e.k2090 + (e.k3803
3255 = 52	3294 = 53	3328 = 54	2684 = 55	541 = 56	3258 = 57	1057 = 58	245 = 59	3684 = 60	1339 = 61	2560 = 62	609 = 63	2837 = 64	263 + e.k1257 + (e.k2052
4430 = 65	442 = 66	4051 = 67	1697 = 68	3210 = 69	3891 = 70	3334 = 71	3813 = 72	1253 = 73	1655 = 74	1560 = 75	3998 = 76	3157 = 77	3461 + e.k2676 + (e.k341
254 = 78	501 = 79	4165 = 80	1111 = 81	4415 = 82	359 = 83	1899 = 84	3807 = 85	2792 = 86	1337 = 87	1397 = 88	4775 = 89	536 = 90	2828 + e.k3255 + (e.k4243
1828 = 91	1429 = 92	3253 = 93	1319 = 94	1216 = 95	4798 = 96	543 = 97	3223 = 98	161 = 99	4488 = 100	1346 = 101	2923 = 102	480 = 103	514 + e.k3334 + (e.k2646
191 = 104	1448 = 105	488 = 106	1032 = 107	3243 = 108	2917 = 109	1242 = 110	4148 = 111	3373 = 112	1996 = 113	3862 = 114	109 = 115	1138 = 116	2917 + e.k4775 + (e.k3895
1116 = 117	4379 = 118	3173 = 119	1268 = 120	1366 = 121	808 = 122	1300 = 123	4770 = 124	1074 = 125	2263 = 126	1266 = 127	141 = 128	1928 = 129	3243 + e.k2883 + (e.k1334
3076 = 130	3748 = 131	1881 = 132	4949 = 133	177 = 134	1653 = 135	3431 = 136	1090 = 137	1683 = 138	2700 = 139	1464 = 140	2187 = 141	2310 = 142	1456 + e.k1899 + (e.k4674
8 = 143	712 = 144	3566 = 145	4688 = 146	4437 = 147	905 = 148	2683 = 149	2445 = 150	996 = 151	2168 = 152	1440 = 153	2621 = 154	2349 = 155	4051 + e.k3334 + (e.k1275
2081 = 156	3835 = 157	3824 = 158	3172 = 159	1198 = 160	4242 = 161	4768 = 162	2901 = 163	3284 = 164	674 = 165	3546 = 166	4553 = 167	4752 = 168	3294 + e.k501 + (e.k383
2974 = 169	2798 = 170	4125 = 171	4050 = 172	3421 = 173	1167 = 174	1843 = 175	114 = 176	1128 = 177	3103 = 178	162 = 179	3120 = 180	2435 = 181	1569 + e.k3103 + (e.k1674
3407 = 182	1592 = 183	3311 = 184	4381 = 185	4427 = 186	4892 = 187	3220 = 188	2431 = 189	1854 = 190	1108 = 191	4714 = 192	3625 = 193	1963 = 194	1569 + e.k2310 + (e.k4448
1800 = 195	4391 = 196	1870 = 197	4367 = 198	973 = 199	412 = 200	3050 = 201	4328 = 202	1558 = 203	3359 = 204	2171 = 205	671 = 206	864 = 207	1268 + e.k3220 + (e.k1154
1332 = 208	4549 = 209	2747 = 210	664 = 211	3086 = 212	65 = 213	4896 = 214	3725 = 215	1490 = 216	834 = 217	3134 = 218	48 = 219	4482 = 220	2187 + e.k2310 + (e.k2310
9 = 221	1746 = 222	1798 = 223	3073 = 224	1522 = 225	832 = 226	319 = 227	4662 = 228	3803 = 229	2858 = 230	827 = 231	4641 = 232	1384 = 233	1464 + e.k1490 + (e.k363
1988 = 234	1437 = 235	3270 = 236	3596 = 237	2298 = 238	1289 = 239	2274 = 240	3798 = 241	3517 = 242	2924 = 243	81 = 244	862 = 245	4003 = 246	3275 + e.k1963 + (e.k4211
4745 = 247	2420 = 248	2080 = 249	3654 = 250	2121 = 251	2505 = 252	3704 = 253	2001 = 254	1013 = 255	1129 = 256	1500 = 257	3423 = 258	4297 = 259	3891 + e.k1397 + (e.k1849`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e58 = fill58(born());
function fill59(e) {`,
      [
        `3690 = 0	1522 = 1	1397 = 2	1237 = 3	735 = 4	555 = 5	4457 = 6	3882 = 7	2352 = 8	3981 = 9	3063 = 10	3598 = 11	4760 = 12	2352 + e.k4457 + (e.k2588
3263 = 13	768 = 14	161 = 15	3723 = 16	2443 = 17	2392 = 18	3455 = 19	2551 = 20	2541 = 21	1074 = 22	1607 = 23	1011 = 24	2923 = 25	1607 + e.k1397 + (e.k2552
273 = 26	221 = 27	852 = 28	3330 = 29	765 = 30	2579 = 31	2938 = 32	3130 = 33	1103 = 34	4380 = 35	3834 = 36	2408 = 37	3940 = 38	221 + e.k3882 + (e.k4912
1232 = 39	3801 = 40	3443 = 41	4295 = 42	2720 = 43	2629 = 44	2847 = 45	3129 = 46	1279 = 47	4509 = 48	4168 = 49	1903 = 50	4988 = 51	1522 + e.k1607 + (e.k676
2321 = 52	1024 = 53	1209 = 54	755 = 55	1150 = 56	1335 = 57	4071 = 58	415 = 59	4908 = 60	4635 = 61	304 = 62	2014 = 63	423 = 64	3940 + e.k4760 + (e.k2340
3213 = 65	1776 = 66	3702 = 67	1377 = 68	1233 = 69	330 = 70	3210 = 71	1735 = 72	4172 = 73	4717 = 74	2103 = 75	4089 = 76	3134 = 77	273 + e.k1607 + (e.k600
3889 = 78	676 = 79	537 = 80	4011 = 81	3740 = 82	3523 = 83	4665 = 84	2502 = 85	2577 = 86	3498 = 87	4896 = 88	4701 = 89	1902 = 90	1279 + e.k1237 + (e.k2232
3305 = 91	3482 = 92	1564 = 93	3621 = 94	3677 = 95	1953 = 96	249 = 97	524 = 98	1845 = 99	1642 = 100	1236 = 101	2361 = 102	1755 = 103	3598 + e.k4988 + (e.k330
2926 = 104	1265 = 105	3375 = 106	257 = 107	2192 = 108	596 = 109	1393 = 110	242 = 111	2076 = 112	4799 = 113	4329 = 114	2907 = 115	1032 = 116	1902 + e.k3375 + (e.k739
855 = 117	9 = 118	1875 = 119	125 = 120	3735 = 121	4400 = 122	534 = 123	1852 = 124	791 = 125	2286 = 126	1088 = 127	3725 = 128	680 = 129	415 + e.k4380 + (e.k602
3470 = 130	4679 = 131	2473 = 132	428 = 133	1087 = 134	2851 = 135	1290 = 136	4446 = 137	172 = 138	1901 = 139	4608 = 140	3833 = 141	3400 = 142	1209 + e.k1236 + (e.k4942
3265 = 143	2415 = 144	2657 = 145	403 = 146	206 = 147	3873 = 148	2767 = 149	803 = 150	2628 = 151	1419 = 152	1337 = 153	873 = 154	1836 = 155	3690 + e.k304 + (e.k937
3027 = 156	1842 = 157	1264 = 158	1956 = 159	3659 = 160	2389 = 161	720 = 162	2085 = 163	973 = 164	2158 = 165	600 = 166	285 = 167	190 = 168	1397 + e.k3027 + (e.k284
2971 = 169	2550 = 170	897 = 171	2816 = 172	2905 = 173	1865 = 174	4504 = 175	1462 = 176	4891 = 177	2123 = 178	4049 = 179	2883 = 180	3066 = 181	1088 + e.k1642 + (e.k2722
4632 = 182	3778 = 183	3384 = 184	4146 = 185	4707 = 186	1920 = 187	1164 = 188	3337 = 189	1577 = 190	3529 = 191	4082 = 192	2320 = 193	199 = 194	4988 + e.k273 + (e.k1416
1596 = 195	2921 = 196	2742 = 197	1781 = 198	3334 = 199	4962 = 200	826 = 201	3610 = 202	4963 = 203	1343 = 204	4119 = 205	1484 = 206	771 = 207	1088 + e.k4962 + (e.k2463
4959 = 208	2908 = 209	645 = 210	1156 = 211	4546 = 212	2002 = 213	947 = 214	1524 = 215	464 = 216	232 = 217	872 = 218	3782 = 219	2956 = 220	1377 + e.k4665 + (e.k172
667 = 221	498 = 222	205 = 223	3379 = 224	4110 = 225	960 = 226	940 = 227	3217 = 228	3074 = 229	3667 = 230	811 = 231	1289 = 232	2413 = 233	676 + e.k600 + (e.k4959
3474 = 234	604 = 235	2308 = 236	1073 = 237	687 = 238	2331 = 239	2128 = 240	3875 = 241	2749 = 242	3517 = 243	3494 = 244	3506 = 245	4836 = 246	873 + e.k205 + (e.k2393
20 = 247	3159 = 248	3423 = 249	2538 = 250	4215 = 251	750 = 252	3987 = 253	1672 = 254	2290 = 255	849 = 256	4918 = 257	1936 = 258	4812 = 259	2577 + e.k190 + (e.k4183`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l, m, o) => `  e.k${a};
  e.k${b};
  e.k${c};
  e.k${d};
  e.k${e};
  e.k${f};
  e.k${g};
  e.k${h};
  e.k${i};
  e.k${j};
  e.k${k};
  e.k${l};
  e.k${m};
  for (let i = 0; i < 20; i++) sum += e.k${o} === undefined ? 1 : 0);`,
      ],
      `  return e;
}
const e59 = fill59(born());
console.log(sum);
`,
    ),
    "what-an-object-is-created-with-is-asked-through-a-descriptor.mjs": text(
      `// What an object has of its own from its creation and nobody wrote: the length of an array, the length and name of a function, lastIndex of a regular expression, cause of an error, the characters and the length of a text ..
// Each kind is asked through a descriptor, each question in a function of its own: the value goes into a field, and the field is asked for its type. With a number as argument only that case runs.`,
      [
        `[1, 2, 3], "length"	array literal length', typeof	[], "length	empty array length', typeof	[7, 8], "1"	array element', typeof	[7, 8], 0	array element by number', typeof
new Array(4), "length"	new Array length', typeof	Array.of(1, 2), "length	Array.of length', typeof	[1, 2].map(x => x + 1), "length"	mapped array length', typeof	function (a, b) {}, "length"	function length', typeof
function named() {}, "name"	function name', typeof	function made() {}, "prototype	function prototype', typeof	(a => a), "length"	arrow length', typeof	(() => 1), "name"	arrow name', typeof
class { constructor(a) {} }, "length"	class length', typeof	class Named {}, "name	class name', typeof	class Made {}, "prototype"	class prototype', typeof	(class Made {}).prototype, "constructor"	prototype constructor', typeof
({ method() {} }).method, "name"	method name', typeof	async function (a) {}, "length	async function length', typeof	function* () {}, "prototype"	generator function prototype', typeof	(function (a, b) {}).bind(null, 1), "length"	bound length', typeof
(function named() {}).bind(null), "name"	bound name', typeof	new Error("said"), "message	error message', typeof	new Error("said"), "stack"	error stack', typeof	new Error("said", { cause: 5 }), "cause"	error cause', typeof
new TypeError("said"), "message"	type error message', typeof	new AggregateError([1], "said"), "errors	aggregate errors', typeof	/a/g, "lastIndex"	regexp lastIndex', typeof	new RegExp("a"), "lastIndex"	new RegExp lastIndex', typeof
new String("abc"), "length"	String object length', typeof	new String("abc"), "1	String object character', typeof	new Uint8Array([5, 6]), "1"	typed array element', typeof	"abc".match(/b/), "index"	match index', typeof
"abc".match(/b/), "input"	match input', typeof	"abc".match(/(?<g>b)/), "groups	match groups', typeof	"a,b".split(","), "length"	split length', typeof	(s => s)\`x\`, "raw"	template raw', typeof
(s => s)\`x\${1}y\`, "length"	template length', typeof	[1][Symbol.iterator]().next(), "value	iterator result value', typeof	[1][Symbol.iterator]().next(), "done"	iterator result done', typeof	Object.entries({ a: 1 })[0], "length"	entries pair', typeof
Object.getOwnPropertyDescriptor({ a: 1 }, "a"), "writable"	descriptor of a descriptor', typeof	({ kept: 1 }), "kept	literal field', typeof	new (class { kept = 1 })(), "kept"	instance field', typeof	JSON.parse('{"a":1}'), "a"	JSON.parse field', typeof
Object.assign({}, { a: 1 }), "a"	Object.assign field', typeof	({ ...{ a: 1 } }), "a	spread field', typeof	((...rest) => rest)(1, 2), "length"	rest array length', typeof	(function () { return arguments; })(1, 2), "length"	sloppy arguments length', typeof
(function () { return arguments; })(1, 2), "0"	arguments element', typeof	Promise.withResolvers(), "resolve	Promise.withResolvers resolve', typeof	Proxy.revocable({}, {}), "revoke"	Proxy.revocable revoke', typeof	Object.groupBy([1], () => 'g'), "g"	Object.groupBy group', typeof
Object.fromEntries([['a', 1]]), "a"	Object.fromEntries field', typeof	structuredClone({ a: 1 }), "a	structuredClone field', typeof	new Intl.NumberFormat('en').resolvedOptions(), "locale"	Intl resolved locale', typeof	new Map([[1, 2]]), "size"	URLSearchParams none', typeof
"text", 1	a character of a text', typeof holder.held,	"text", "length	the length of a text', typeof holder.held,	"text", 9	behind the end of a text', typeof holder.held,	"text", "missing"	a name that a text does not have', typeof holder.held,
new String("text"), 2	a character of a String object', typeof holder.held,	new String("text"), "length	the length of a String object', typeof holder.held,	\`\${process.argv.length}text\`, 0	a character of a text made at run time', typeof holder.held,	process.argv.length > 99 ? { 0: 5 } : "text", 0	a text or an object', typeof holder.held,`,
        (n, a, b, c, d, e, f, g, h) => `function case${4 * n}() {
  const found = Object.getOwnPropertyDescriptor(${a});
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('${b} holder.held);
}
function case${4 * n + 1}() {
  const found = Object.getOwnPropertyDescriptor(${c}");
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('${d} holder.held);
}
function case${4 * n + 2}() {
  const found = Object.getOwnPropertyDescriptor(${e});
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('${f} holder.held);
}
function case${4 * n + 3}() {
  const found = Object.getOwnPropertyDescriptor(${g});
  const holder = { held: found === undefined ? "no descriptor" : found.value };
  console.log('${h} holder.held);
}`,
      ],
      `const cases = [case0, case1, case2, case3, case4, case5, case6, case7, case8, case9, case10, case11, case12, case13, case14, case15, case16, case17, case18, case19, case20, case21, case22, case23, case24, case25, case26, case27, case28, case29, case30, case31, case32, case33, case34, case35, case36, case37, case38, case39, case40, case41, case42, case43, case44, case45, case46, case47, case48, case49, case50, case51, case52, case53, case54, case55, case56, case57, case58, case59, case60, case61, case62, case63];
const chosen = process.argv[2];
if (chosen === undefined) for (const each of cases) each();
else cases[Number(chosen)]();
`,
    ),
    ...untypedTwins("objects", "js", ["many-late-fields"]),
    "fields-of-a-wide-object-are-created-in-many-orders.js": text(
      `function inOrder(object) {`,
      [120, n => `  object.f${n} = ${n};`],
      `  return object;
}
function backwards(object) {`,
      [120, n => `  object.f${119 - n} = ${119 - n};`],
      `  return object;
}
function inStrides(object) {`,
      [
        9,
        n => `  object.f${n} = "f${n}";
  object.f${n + 37} = "f${n + 37}";
  object.f${n + 74} = "f${n + 74}";
  object.f${n + 111} = "f${n + 111}";
  object.f${n + 28} = "f${n + 28}";
  object.f${n + 65} = "f${n + 65}";
  object.f${n + 102} = "f${n + 102}";
  object.f${n + 19} = "f${n + 19}";
  object.f${n + 56} = "f${n + 56}";
  object.f${n + 93} = "f${n + 93}";
  object.f${n + 10} = "f${n + 10}";
  object.f${n + 47} = "f${n + 47}";
  object.f${n + 84} = "f${n + 84}";`,
      ],
      `  object.f9 = "f9";
  object.f46 = "f46";
  object.f83 = "f83";
  return object;
}
function everyThird(object, from) {`,
      [
        40,
        n => `  if (from === 0) object.f${3 * n} = ${3 * n};
  if (from === 1) object.f${3 * n + 1} = ${3 * n + 1};
  if (from === 2) object.f${3 * n + 2} = ${3 * n + 2};`,
      ],
      `  return object;
}
function show(label, object) {
  const keys = Object.keys(object);
  console.log(label, keys.length, keys.join(" "));
  console.log(label, JSON.stringify(object).length, Object.values(object).slice(0, 12).join(" "));
}
class Wide {}
show("in order", inOrder({}));
show("backwards", backwards({}));
show("in strides", inStrides({}));
show("thirds 2 0 1", everyThird(everyThird(everyThird({}, 2), 0), 1));
show("thirds 1 2", everyThird(everyThird({}, 1), 2));
show("class in order", inOrder(new Wide()));
show("class backwards", backwards(new Wide()));
show("class in strides", inStrides(new Wide()));
show("class thirds 1 0 2", everyThird(everyThird(everyThird(new Wide(), 1), 0), 2));
for (let round = 0; round < 3; round++) {
  show("again backwards " + round, backwards({}));
  show("again strides " + round, inStrides(new Wide()));
}
const deleted = backwards({});
delete deleted.f60;
delete deleted.f3;
deleted.f60 = "back";
show("deleted and created again", deleted);
`,
    ),
    "large-constants-in-huge-frame.ts": text(
      `// Generated: a function with a very large stack frame formats eight-digit numbers.
declare const console: any;
const table: ((x: number) => number)[] = [(x) => x + 1, (x) => x * 2 + 1];
const seen = new Map<string, number>();
function work20(n: number): string {`,
      [
        10,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work21(n: number): string {`,
      [
        10,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a20 = table[0](n + 20);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work22(n: number): string {`,
      [
        11,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work23(n: number): string {`,
      [
        11,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a22 = table[0](n + 22);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work24(n: number): string {`,
      [
        12,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work25(n: number): string {`,
      [
        12,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a24 = table[0](n + 24);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work26(n: number): string {`,
      [
        13,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work27(n: number): string {`,
      [
        13,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a26 = table[0](n + 26);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work28(n: number): string {`,
      [
        14,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work29(n: number): string {`,
      [
        14,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a28 = table[0](n + 28);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work30(n: number): string {`,
      [
        15,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work31(n: number): string {`,
      [
        15,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a30 = table[0](n + 30);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work32(n: number): string {`,
      [
        16,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work33(n: number): string {`,
      [
        16,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a32 = table[0](n + 32);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work34(n: number): string {`,
      [
        17,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work35(n: number): string {`,
      [
        17,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a34 = table[0](n + 34);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34 + a34 * 35;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work36(n: number): string {`,
      [
        18,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34 + a34 * 35 + a35 * 36;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work37(n: number): string {`,
      [
        18,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a36 = table[0](n + 36);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34 + a34 * 35 + a35 * 36 + a36 * 37;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work38(n: number): string {`,
      [
        19,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34 + a34 * 35 + a35 * 36 + a36 * 37 + a37 * 38;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work39(n: number): string {`,
      [
        19,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a38 = table[0](n + 38);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34 + a34 * 35 + a35 * 36 + a36 * 37 + a37 * 38 + a38 * 39;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work40(n: number): string {`,
      [
        20,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34 + a34 * 35 + a35 * 36 + a36 * 37 + a37 * 38 + a38 * 39 + a39 * 40;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work41(n: number): string {`,
      [
        20,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a40 = table[0](n + 40);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34 + a34 * 35 + a35 * 36 + a36 * 37 + a37 * 38 + a38 * 39 + a39 * 40 + a40 * 41;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work42(n: number): string {`,
      [
        21,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34 + a34 * 35 + a35 * 36 + a36 * 37 + a37 * 38 + a38 * 39 + a39 * 40 + a40 * 41 + a41 * 42;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work43(n: number): string {`,
      [
        21,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  const a42 = table[0](n + 42);
  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34 + a34 * 35 + a35 * 36 + a36 * 37 + a37 * 38 + a38 * 39 + a39 * 40 + a40 * 41 + a41 * 42 + a42 * 43;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}
function work44(n: number): string {`,
      [
        22,
        n => `  const a${2 * n} = table[0](n + ${2 * n});
  const a${2 * n + 1} = table[1](n + ${2 * n + 1});`,
      ],
      `  let text = "(";
  text += n;
  if (n > 5) text += ")";
  const had = seen.get(text);
  seen.set(text, n);
  const b = table[n & 1](n);
  const sum = b + a0 * 1 + a1 * 2 + a2 * 3 + a3 * 4 + a4 * 5 + a5 * 6 + a6 * 7 + a7 * 8 + a8 * 9 + a9 * 10 + a10 * 11 + a11 * 12 + a12 * 13 + a13 * 14 + a14 * 15 + a15 * 16 + a16 * 17 + a17 * 18 + a18 * 19 + a19 * 20 + a20 * 21 + a21 * 22 + a22 * 23 + a23 * 24 + a24 * 25 + a25 * 26 + a26 * 27 + a27 * 28 + a28 * 29 + a29 * 30 + a30 * 31 + a31 * 32 + a32 * 33 + a33 * 34 + a34 * 35 + a35 * 36 + a36 * 37 + a37 * 38 + a38 * 39 + a39 * 40 + a40 * 41 + a41 * 42 + a42 * 43 + a43 * 44;
  return (had === undefined ? "new " : "had ") + [...seen.keys()].pop() + " " + sum;
}`,
      [
        25,
        n =>
          `for (const n of [0, 7, 42, 12345, 99999999, 100000000, 1234567, 42]) console.log(${n + 20}, work${n + 20}(n));`,
      ],
      ``,
    ),
    "large-literals-typed-as-dictionaries.ts": text(
      `declare const console: { log(...values: any[]): void };

const table: Record<string, string> = {`,
      [400, n => `  name${n}: "value ${n}",`],
      `  "with a space": "quoted",
};

const nested: Record<string, { flags: string[]; safe: boolean }> = {`,
      [
        100,
        n => `  "command-${2 * n}": { flags: ["-a", "-b${2 * n}"], safe: false },
  "command-${2 * n + 1}": { flags: ["-a", "-b${2 * n + 1}"], safe: true },`,
      ],
      `};

const keys = Object.keys(table);
console.log(keys.length, keys[0], keys[3], keys[399], keys[400], table.name3, table.name399, table["with a space"]);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(table, "name250")));
delete table.name250;
table.added = "later";
console.log(Object.keys(table).length, "name250" in table, Object.keys(table).at(-1), Object.isExtensible(table), Object.getPrototypeOf(table) === Object.prototype);
let safe = 0;
for (const name in nested) if (nested[name]!.safe) safe += nested[name]!.flags.length;
console.log(Object.keys(nested).length, safe, nested["command-199"]!.flags.join());
`,
    ),
    "one-object-of-forty-names-is-built-in-thirty-ways.js": text(
      `const kept = [];
const turns = Number(process.env.WAYS_TURNS || 1);
const only = process.env.WAYS_ONLY;
function way(label, f) { if (only && only !== label) return; for (let turn = 0; turn < turns; turn++) kept.push(f(turn)); }
function nothing() {}
let out = null;
function letOut(o) { out = o; }
function byStores(t) {
  const o = {};`,
      [40, n => `  o.st${n} = t;`],
      `  return o;
}
function byStoresWithCalls(t) {
  const o = {};`,
      [40, n => `  o.sc${n} = t; nothing();`],
      `  return o;
}
function byLiteral(t) {
  return { li0: t, li1: t, li2: t, li3: t, li4: t, li5: t, li6: t, li7: t, li8: t, li9: t, li10: t, li11: t, li12: t, li13: t, li14: t, li15: t, li16: t, li17: t, li18: t, li19: t, li20: t, li21: t, li22: t, li23: t, li24: t, li25: t, li26: t, li27: t, li28: t, li29: t, li30: t, li31: t, li32: t, li33: t, li34: t, li35: t, li36: t, li37: t, li38: t, li39: t };
}
const keysK = ["ke0","ke1","ke2","ke3","ke4","ke5","ke6","ke7","ke8","ke9","ke10","ke11","ke12","ke13","ke14","ke15","ke16","ke17","ke18","ke19","ke20","ke21","ke22","ke23","ke24","ke25","ke26","ke27","ke28","ke29","ke30","ke31","ke32","ke33","ke34","ke35","ke36","ke37","ke38","ke39"];
function byKeys(t) {
  const o = {};
  for (const k of keysK) o[k] = t;
  return o;
}
const halfA = { sa0: 1, sa1: 1, sa2: 1, sa3: 1, sa4: 1, sa5: 1, sa6: 1, sa7: 1, sa8: 1, sa9: 1, sa10: 1, sa11: 1, sa12: 1, sa13: 1, sa14: 1, sa15: 1, sa16: 1, sa17: 1, sa18: 1, sa19: 1 }, halfB = { sb0: 1, sb1: 1, sb2: 1, sb3: 1, sb4: 1, sb5: 1, sb6: 1, sb7: 1, sb8: 1, sb9: 1, sb10: 1, sb11: 1, sb12: 1, sb13: 1, sb14: 1, sb15: 1, sb16: 1, sb17: 1, sb18: 1, sb19: 1 };
function bySpreads(t) {
  return { ...halfA, ...halfB };
}
const halfC = { aa0: 1, aa1: 1, aa2: 1, aa3: 1, aa4: 1, aa5: 1, aa6: 1, aa7: 1, aa8: 1, aa9: 1, aa10: 1, aa11: 1, aa12: 1, aa13: 1, aa14: 1, aa15: 1, aa16: 1, aa17: 1, aa18: 1, aa19: 1 }, halfD = { ab0: 1, ab1: 1, ab2: 1, ab3: 1, ab4: 1, ab5: 1, ab6: 1, ab7: 1, ab8: 1, ab9: 1, ab10: 1, ab11: 1, ab12: 1, ab13: 1, ab14: 1, ab15: 1, ab16: 1, ab17: 1, ab18: 1, ab19: 1 };
function byAssign(t) {
  return Object.assign({}, halfC, halfD);
}
const text = '{"js0":1,"js1":1,"js2":1,"js3":1,"js4":1,"js5":1,"js6":1,"js7":1,"js8":1,"js9":1,"js10":1,"js11":1,"js12":1,"js13":1,"js14":1,"js15":1,"js16":1,"js17":1,"js18":1,"js19":1,"js20":1,"js21":1,"js22":1,"js23":1,"js24":1,"js25":1,"js26":1,"js27":1,"js28":1,"js29":1,"js30":1,"js31":1,"js32":1,"js33":1,"js34":1,"js35":1,"js36":1,"js37":1,"js38":1,"js39":1}';
function byParse(t) {
  return JSON.parse(text);
}
const keysD = ["de0","de1","de2","de3","de4","de5","de6","de7","de8","de9","de10","de11","de12","de13","de14","de15","de16","de17","de18","de19","de20","de21","de22","de23","de24","de25","de26","de27","de28","de29","de30","de31","de32","de33","de34","de35","de36","de37","de38","de39"];
function byDefine(t) {
  const o = {};
  for (const k of keysD) Object.defineProperty(o, k, { value: t, enumerable: true, writable: true, configurable: true });
  return o;
}
function byGetters(t) {
  const o = {};
  for (const k of keysD) Object.defineProperty(o, "g" + k, { get: nothing, enumerable: true, configurable: true });
  return o;
}
const pairs = [["fe0",1],["fe1",1],["fe2",1],["fe3",1],["fe4",1],["fe5",1],["fe6",1],["fe7",1],["fe8",1],["fe9",1],["fe10",1],["fe11",1],["fe12",1],["fe13",1],["fe14",1],["fe15",1],["fe16",1],["fe17",1],["fe18",1],["fe19",1],["fe20",1],["fe21",1],["fe22",1],["fe23",1],["fe24",1],["fe25",1],["fe26",1],["fe27",1],["fe28",1],["fe29",1],["fe30",1],["fe31",1],["fe32",1],["fe33",1],["fe34",1],["fe35",1],["fe36",1],["fe37",1],["fe38",1],["fe39",1]];
function byFromEntries(t) {
  return Object.fromEntries(pairs);
}
class Fields { cf0 = 1; cf1 = 1; cf2 = 1; cf3 = 1; cf4 = 1; cf5 = 1; cf6 = 1; cf7 = 1; cf8 = 1; cf9 = 1; cf10 = 1; cf11 = 1; cf12 = 1; cf13 = 1; cf14 = 1; cf15 = 1; cf16 = 1; cf17 = 1; cf18 = 1; cf19 = 1; cf20 = 1; cf21 = 1; cf22 = 1; cf23 = 1; cf24 = 1; cf25 = 1; cf26 = 1; cf27 = 1; cf28 = 1; cf29 = 1; cf30 = 1; cf31 = 1; cf32 = 1; cf33 = 1; cf34 = 1; cf35 = 1; cf36 = 1; cf37 = 1; cf38 = 1; cf39 = 1; }
function byClassFields(t) {
  return new Fields();
}
function Ctor(t) {`,
      [40, n => `  this.ct${n} = t; nothing();`],
      `}
function byConstructor(t) {
  return new Ctor(t);
}
function byComputedLiteral(t) {
  return { [keysK[0] + "c"]: t, [keysK[1] + "c"]: t, [keysK[2] + "c"]: t, [keysK[3] + "c"]: t, [keysK[4] + "c"]: t, [keysK[5] + "c"]: t, [keysK[6] + "c"]: t, [keysK[7] + "c"]: t, [keysK[8] + "c"]: t, [keysK[9] + "c"]: t, [keysK[10] + "c"]: t, [keysK[11] + "c"]: t, [keysK[12] + "c"]: t, [keysK[13] + "c"]: t, [keysK[14] + "c"]: t, [keysK[15] + "c"]: t, [keysK[16] + "c"]: t, [keysK[17] + "c"]: t, [keysK[18] + "c"]: t, [keysK[19] + "c"]: t, [keysK[20] + "c"]: t, [keysK[21] + "c"]: t, [keysK[22] + "c"]: t, [keysK[23] + "c"]: t, [keysK[24] + "c"]: t, [keysK[25] + "c"]: t, [keysK[26] + "c"]: t, [keysK[27] + "c"]: t, [keysK[28] + "c"]: t, [keysK[29] + "c"]: t, [keysK[30] + "c"]: t, [keysK[31] + "c"]: t, [keysK[32] + "c"]: t, [keysK[33] + "c"]: t, [keysK[34] + "c"]: t, [keysK[35] + "c"]: t, [keysK[36] + "c"]: t, [keysK[37] + "c"]: t, [keysK[38] + "c"]: t, [keysK[39] + "c"]: t };
}
function byStoresAfterItGotOut(t) {
  const o = {};
  letOut(o);`,
      [40, n => `  o.go${n} = t;`],
      `  return o;
}
function fill(o, t) {`,
      [40, n => `  o.pa${n} = t;`],
      `}
function byCallee(t) {
  const o = {};
  fill(o, t);
  return o;
}
class Later { constructor() { this.first = 1; }`,
      [40, n => `  m${n}(t) { this.la${n} = t; }`],
      `}
function byMethodsLater(t) {
  const o = new Later();`,
      [40, n => `  o.m${n}(t);`],
      `  return o;
}
function byOrAssign(t) {
  const o = {};
  letOut(o);`,
      [40, n => `  o.oa${n} ??= t;`],
      `  return o;
}
function byStatics(t) {
  class S {}`,
      [40, n => `  S.ss${n} = t;`],
      `  return S;
}
function byFunctionProperties(t) {
  function f() {}`,
      [40, n => `  f.fp${n} = t;`],
      `  return f;
}
function byPrototype(t) {
  function P() {}`,
      [40, n => `  P.prototype.pr${n} = nothing;`],
      `  return P;
}
function commonJS(cb) { let mod; return () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); }
function byExports(t) {
  return commonJS((exports, module) => {`,
      [40, n => `    exports.ex${n} = t;`],
      `  })();
}
function byEmptyClassAgain(t) {
  class D extends Object {}
  Object.defineProperty(D, "name", { value: "n" + t });
  return D;
}
function byClassAgain(t) {
  return class C { m0() { return t; } m1() { return t; } m2() { return t; } m3() { return t; } m4() { return t; } m5() { return t; } m6() { return t; } m7() { return t; } m8() { return t; } m9() { return t; } get g() { return t; } static s0() { return t; } static s1() { return t; } };
}
const withGetter = { wg0: 1, wg1: 1, wg2: 1, wg3: 1, wg4: 1, wg5: 1, wg6: 1, wg7: 1, wg8: 1, wg9: 1, wg10: 1, wg11: 1, wg12: 1, wg13: 1, wg14: 1, wg15: 1, wg16: 1, wg17: 1, wg18: 1, wg19: 1, wg20: 1, wg21: 1, wg22: 1, wg23: 1, wg24: 1, wg25: 1, wg26: 1, wg27: 1, wg28: 1, wg29: 1, wg30: 1, wg31: 1, wg32: 1, wg33: 1, wg34: 1, wg35: 1, wg36: 1, wg37: 1, wg38: 1, get wgLast() { return 1; } };
function bySpreadOfGetter(t) {
  return { ...withGetter };
}
function byRestOfGetter(t) {
  const { wg0, ...rest } = withGetter;
  return rest;
}
function byLiteral63(t) {
  return { L63_0: t, L63_1: t, L63_2: t, L63_3: t, L63_4: t, L63_5: t, L63_6: t, L63_7: t, L63_8: t, L63_9: t, L63_10: t, L63_11: t, L63_12: t, L63_13: t, L63_14: t, L63_15: t, L63_16: t, L63_17: t, L63_18: t, L63_19: t, L63_20: t, L63_21: t, L63_22: t, L63_23: t, L63_24: t, L63_25: t, L63_26: t, L63_27: t, L63_28: t, L63_29: t, L63_30: t, L63_31: t, L63_32: t, L63_33: t, L63_34: t, L63_35: t, L63_36: t, L63_37: t, L63_38: t, L63_39: t, L63_40: t, L63_41: t, L63_42: t, L63_43: t, L63_44: t, L63_45: t, L63_46: t, L63_47: t, L63_48: t, L63_49: t, L63_50: t, L63_51: t, L63_52: t, L63_53: t, L63_54: t, L63_55: t, L63_56: t, L63_57: t, L63_58: t, L63_59: t, L63_60: t, L63_61: t, L63_62: t };
}
function byLiteral70(t) {
  return { L70_0: t, L70_1: t, L70_2: t, L70_3: t, L70_4: t, L70_5: t, L70_6: t, L70_7: t, L70_8: t, L70_9: t, L70_10: t, L70_11: t, L70_12: t, L70_13: t, L70_14: t, L70_15: t, L70_16: t, L70_17: t, L70_18: t, L70_19: t, L70_20: t, L70_21: t, L70_22: t, L70_23: t, L70_24: t, L70_25: t, L70_26: t, L70_27: t, L70_28: t, L70_29: t, L70_30: t, L70_31: t, L70_32: t, L70_33: t, L70_34: t, L70_35: t, L70_36: t, L70_37: t, L70_38: t, L70_39: t, L70_40: t, L70_41: t, L70_42: t, L70_43: t, L70_44: t, L70_45: t, L70_46: t, L70_47: t, L70_48: t, L70_49: t, L70_50: t, L70_51: t, L70_52: t, L70_53: t, L70_54: t, L70_55: t, L70_56: t, L70_57: t, L70_58: t, L70_59: t, L70_60: t, L70_61: t, L70_62: t, L70_63: t, L70_64: t, L70_65: t, L70_66: t, L70_67: t, L70_68: t, L70_69: t };
}
function byLiteral110(t) {
  return { L110_0: t, L110_1: t, L110_2: t, L110_3: t, L110_4: t, L110_5: t, L110_6: t, L110_7: t, L110_8: t, L110_9: t, L110_10: t, L110_11: t, L110_12: t, L110_13: t, L110_14: t, L110_15: t, L110_16: t, L110_17: t, L110_18: t, L110_19: t, L110_20: t, L110_21: t, L110_22: t, L110_23: t, L110_24: t, L110_25: t, L110_26: t, L110_27: t, L110_28: t, L110_29: t, L110_30: t, L110_31: t, L110_32: t, L110_33: t, L110_34: t, L110_35: t, L110_36: t, L110_37: t, L110_38: t, L110_39: t, L110_40: t, L110_41: t, L110_42: t, L110_43: t, L110_44: t, L110_45: t, L110_46: t, L110_47: t, L110_48: t, L110_49: t, L110_50: t, L110_51: t, L110_52: t, L110_53: t, L110_54: t, L110_55: t, L110_56: t, L110_57: t, L110_58: t, L110_59: t, L110_60: t, L110_61: t, L110_62: t, L110_63: t, L110_64: t, L110_65: t, L110_66: t, L110_67: t, L110_68: t, L110_69: t, L110_70: t, L110_71: t, L110_72: t, L110_73: t, L110_74: t, L110_75: t, L110_76: t, L110_77: t, L110_78: t, L110_79: t, L110_80: t, L110_81: t, L110_82: t, L110_83: t, L110_84: t, L110_85: t, L110_86: t, L110_87: t, L110_88: t, L110_89: t, L110_90: t, L110_91: t, L110_92: t, L110_93: t, L110_94: t, L110_95: t, L110_96: t, L110_97: t, L110_98: t, L110_99: t, L110_100: t, L110_101: t, L110_102: t, L110_103: t, L110_104: t, L110_105: t, L110_106: t, L110_107: t, L110_108: t, L110_109: t };
}
function byLiteral300(t) {
  return { L300_0: t, L300_1: t, L300_2: t, L300_3: t, L300_4: t, L300_5: t, L300_6: t, L300_7: t, L300_8: t, L300_9: t, L300_10: t, L300_11: t, L300_12: t, L300_13: t, L300_14: t, L300_15: t, L300_16: t, L300_17: t, L300_18: t, L300_19: t, L300_20: t, L300_21: t, L300_22: t, L300_23: t, L300_24: t, L300_25: t, L300_26: t, L300_27: t, L300_28: t, L300_29: t, L300_30: t, L300_31: t, L300_32: t, L300_33: t, L300_34: t, L300_35: t, L300_36: t, L300_37: t, L300_38: t, L300_39: t, L300_40: t, L300_41: t, L300_42: t, L300_43: t, L300_44: t, L300_45: t, L300_46: t, L300_47: t, L300_48: t, L300_49: t, L300_50: t, L300_51: t, L300_52: t, L300_53: t, L300_54: t, L300_55: t, L300_56: t, L300_57: t, L300_58: t, L300_59: t, L300_60: t, L300_61: t, L300_62: t, L300_63: t, L300_64: t, L300_65: t, L300_66: t, L300_67: t, L300_68: t, L300_69: t, L300_70: t, L300_71: t, L300_72: t, L300_73: t, L300_74: t, L300_75: t, L300_76: t, L300_77: t, L300_78: t, L300_79: t, L300_80: t, L300_81: t, L300_82: t, L300_83: t, L300_84: t, L300_85: t, L300_86: t, L300_87: t, L300_88: t, L300_89: t, L300_90: t, L300_91: t, L300_92: t, L300_93: t, L300_94: t, L300_95: t, L300_96: t, L300_97: t, L300_98: t, L300_99: t, L300_100: t, L300_101: t, L300_102: t, L300_103: t, L300_104: t, L300_105: t, L300_106: t, L300_107: t, L300_108: t, L300_109: t, L300_110: t, L300_111: t, L300_112: t, L300_113: t, L300_114: t, L300_115: t, L300_116: t, L300_117: t, L300_118: t, L300_119: t, L300_120: t, L300_121: t, L300_122: t, L300_123: t, L300_124: t, L300_125: t, L300_126: t, L300_127: t, L300_128: t, L300_129: t, L300_130: t, L300_131: t, L300_132: t, L300_133: t, L300_134: t, L300_135: t, L300_136: t, L300_137: t, L300_138: t, L300_139: t, L300_140: t, L300_141: t, L300_142: t, L300_143: t, L300_144: t, L300_145: t, L300_146: t, L300_147: t, L300_148: t, L300_149: t, L300_150: t, L300_151: t, L300_152: t, L300_153: t, L300_154: t, L300_155: t, L300_156: t, L300_157: t, L300_158: t, L300_159: t, L300_160: t, L300_161: t, L300_162: t, L300_163: t, L300_164: t, L300_165: t, L300_166: t, L300_167: t, L300_168: t, L300_169: t, L300_170: t, L300_171: t, L300_172: t, L300_173: t, L300_174: t, L300_175: t, L300_176: t, L300_177: t, L300_178: t, L300_179: t, L300_180: t, L300_181: t, L300_182: t, L300_183: t, L300_184: t, L300_185: t, L300_186: t, L300_187: t, L300_188: t, L300_189: t, L300_190: t, L300_191: t, L300_192: t, L300_193: t, L300_194: t, L300_195: t, L300_196: t, L300_197: t, L300_198: t, L300_199: t, L300_200: t, L300_201: t, L300_202: t, L300_203: t, L300_204: t, L300_205: t, L300_206: t, L300_207: t, L300_208: t, L300_209: t, L300_210: t, L300_211: t, L300_212: t, L300_213: t, L300_214: t, L300_215: t, L300_216: t, L300_217: t, L300_218: t, L300_219: t, L300_220: t, L300_221: t, L300_222: t, L300_223: t, L300_224: t, L300_225: t, L300_226: t, L300_227: t, L300_228: t, L300_229: t, L300_230: t, L300_231: t, L300_232: t, L300_233: t, L300_234: t, L300_235: t, L300_236: t, L300_237: t, L300_238: t, L300_239: t, L300_240: t, L300_241: t, L300_242: t, L300_243: t, L300_244: t, L300_245: t, L300_246: t, L300_247: t, L300_248: t, L300_249: t, L300_250: t, L300_251: t, L300_252: t, L300_253: t, L300_254: t, L300_255: t, L300_256: t, L300_257: t, L300_258: t, L300_259: t, L300_260: t, L300_261: t, L300_262: t, L300_263: t, L300_264: t, L300_265: t, L300_266: t, L300_267: t, L300_268: t, L300_269: t, L300_270: t, L300_271: t, L300_272: t, L300_273: t, L300_274: t, L300_275: t, L300_276: t, L300_277: t, L300_278: t, L300_279: t, L300_280: t, L300_281: t, L300_282: t, L300_283: t, L300_284: t, L300_285: t, L300_286: t, L300_287: t, L300_288: t, L300_289: t, L300_290: t, L300_291: t, L300_292: t, L300_293: t, L300_294: t, L300_295: t, L300_296: t, L300_297: t, L300_298: t, L300_299: t };
}
function control(t) {
  return null;
}
way("byStores", byStores);
way("byStoresWithCalls", byStoresWithCalls);
way("byLiteral", byLiteral);
way("byKeys", byKeys);
way("bySpreads", bySpreads);
way("byAssign", byAssign);
way("byParse", byParse);
way("byDefine", byDefine);
way("byGetters", byGetters);
way("byFromEntries", byFromEntries);
way("byClassFields", byClassFields);
way("byConstructor", byConstructor);
way("byComputedLiteral", byComputedLiteral);
way("byStoresAfterItGotOut", byStoresAfterItGotOut);
way("byCallee", byCallee);
way("byMethodsLater", byMethodsLater);
way("byOrAssign", byOrAssign);
way("byStatics", byStatics);
way("byFunctionProperties", byFunctionProperties);
way("byPrototype", byPrototype);
way("byExports", byExports);
way("byEmptyClassAgain", byEmptyClassAgain);
way("byClassAgain", byClassAgain);
way("bySpreadOfGetter", bySpreadOfGetter);
way("byRestOfGetter", byRestOfGetter);
way("byLiteral63", byLiteral63);
way("byLiteral70", byLiteral70);
way("byLiteral110", byLiteral110);
way("byLiteral300", byLiteral300);
way("control", control);
console.log(kept.length);
`,
    ),
    "own-accessors-read-in-code-that-runs-once.ts": text(
      `// A typed view of the environment: an object with a getter for each declared name, built by one function for several tables of names.
type Field = { parse(raw: string | undefined): unknown };
const flag: Field = { parse: raw => raw === "1" || raw === "true" };
const text: Field = { parse: raw => raw };
const count: Field = { parse: raw => (raw === undefined ? undefined : Number(raw)) };
const paths = { HOME: text, PATH: text, USER: text };
const switches = { NOT_THERE_1: flag, NOT_THERE_2: flag, NOT_THERE_3: flag, LAZY_GETTERS: flag, SWITCH_0: flag, SWITCH_1: flag, SWITCH_2: flag, SWITCH_3: flag, SWITCH_4: flag, SWITCH_5: flag, SWITCH_6: flag, SWITCH_7: flag, SWITCH_8: flag, SWITCH_9: flag, SWITCH_10: flag, SWITCH_11: flag, SWITCH_12: flag, SWITCH_13: flag, SWITCH_14: flag, SWITCH_15: flag, SWITCH_16: flag, SWITCH_17: flag, SWITCH_18: flag, SWITCH_19: flag, SWITCH_20: flag, SWITCH_21: flag, SWITCH_22: flag, SWITCH_23: flag, SWITCH_24: flag, SWITCH_25: flag, SWITCH_26: flag, SWITCH_27: flag, SWITCH_28: flag, SWITCH_29: flag, SWITCH_30: flag, SWITCH_31: flag, SWITCH_32: flag, SWITCH_33: flag, SWITCH_34: flag, SWITCH_35: flag, SWITCH_36: flag, SWITCH_37: flag, SWITCH_38: flag, SWITCH_39: flag, SWITCH_40: flag, SWITCH_41: flag, SWITCH_42: flag, SWITCH_43: flag, SWITCH_44: flag, SWITCH_45: flag, SWITCH_46: flag, SWITCH_47: flag, SWITCH_48: flag, SWITCH_49: flag, SWITCH_50: flag, SWITCH_51: flag, SWITCH_52: flag, SWITCH_53: flag, SWITCH_54: flag, SWITCH_55: flag, SWITCH_56: flag, SWITCH_57: flag, SWITCH_58: flag, SWITCH_59: flag, SWITCH_60: flag, SWITCH_61: flag, SWITCH_62: flag, SWITCH_63: flag, SWITCH_64: flag, SWITCH_65: flag, SWITCH_66: flag, SWITCH_67: flag, SWITCH_68: flag, SWITCH_69: flag, SWITCH_70: flag, SWITCH_71: flag, SWITCH_72: flag, SWITCH_73: flag, SWITCH_74: flag, SWITCH_75: flag, SWITCH_76: flag, SWITCH_77: flag, SWITCH_78: flag, SWITCH_79: flag, SWITCH_80: flag, SWITCH_81: flag, SWITCH_82: flag, SWITCH_83: flag, SWITCH_84: flag, SWITCH_85: flag, SWITCH_86: flag, SWITCH_87: flag, SWITCH_88: flag, SWITCH_89: flag, SWITCH_90: flag, SWITCH_91: flag, SWITCH_92: flag, SWITCH_93: flag, SWITCH_94: flag, SWITCH_95: flag, SWITCH_96: flag, SWITCH_97: flag, SWITCH_98: flag, SWITCH_99: flag, SWITCH_100: flag, SWITCH_101: flag, SWITCH_102: flag, SWITCH_103: flag, SWITCH_104: flag, SWITCH_105: flag, SWITCH_106: flag, SWITCH_107: flag, SWITCH_108: flag, SWITCH_109: flag, SWITCH_110: flag, SWITCH_111: flag, SWITCH_112: flag, SWITCH_113: flag, SWITCH_114: flag, SWITCH_115: flag, SWITCH_116: flag, SWITCH_117: flag, SWITCH_118: flag, SWITCH_119: flag, SWITCH_120: flag, SWITCH_121: flag, SWITCH_122: flag, SWITCH_123: flag, SWITCH_124: flag, SWITCH_125: flag, SWITCH_126: flag, SWITCH_127: flag, SWITCH_128: flag, SWITCH_129: flag, SWITCH_130: flag, SWITCH_131: flag, SWITCH_132: flag, SWITCH_133: flag, SWITCH_134: flag, SWITCH_135: flag, SWITCH_136: flag, SWITCH_137: flag, SWITCH_138: flag, SWITCH_139: flag, SWITCH_140: flag, SWITCH_141: flag, SWITCH_142: flag, SWITCH_143: flag, SWITCH_144: flag, SWITCH_145: flag, SWITCH_146: flag, SWITCH_147: flag, SWITCH_148: flag, SWITCH_149: flag, SWITCH_150: flag, SWITCH_151: flag, SWITCH_152: flag, SWITCH_153: flag, SWITCH_154: flag, SWITCH_155: flag, SWITCH_156: flag, SWITCH_157: flag, SWITCH_158: flag, SWITCH_159: flag, SWITCH_160: flag, SWITCH_161: flag, SWITCH_162: flag, SWITCH_163: flag, SWITCH_164: flag, SWITCH_165: flag, SWITCH_166: flag, SWITCH_167: flag, SWITCH_168: flag, SWITCH_169: flag, SWITCH_170: flag, SWITCH_171: flag, SWITCH_172: flag, SWITCH_173: flag, SWITCH_174: flag, SWITCH_175: flag, SWITCH_176: flag, SWITCH_177: flag, SWITCH_178: flag, SWITCH_179: flag, SWITCH_180: flag, SWITCH_181: flag, SWITCH_182: flag, SWITCH_183: flag, SWITCH_184: flag, SWITCH_185: flag, SWITCH_186: flag, SWITCH_187: flag, SWITCH_188: flag, SWITCH_189: flag, SWITCH_190: flag, SWITCH_191: flag, SWITCH_192: flag, SWITCH_193: flag, SWITCH_194: flag, SWITCH_195: flag, SWITCH_196: flag, SWITCH_197: flag, SWITCH_198: flag, SWITCH_199: flag, SWITCH_200: flag, SWITCH_201: flag, SWITCH_202: flag, SWITCH_203: flag, SWITCH_204: flag, SWITCH_205: flag, SWITCH_206: flag, SWITCH_207: flag, SWITCH_208: flag, SWITCH_209: flag, SWITCH_210: flag, SWITCH_211: flag, SWITCH_212: flag, SWITCH_213: flag, SWITCH_214: flag, SWITCH_215: flag, SWITCH_216: flag, SWITCH_217: flag, SWITCH_218: flag, SWITCH_219: flag, SWITCH_220: flag, SWITCH_221: flag, SWITCH_222: flag, SWITCH_223: flag, SWITCH_224: flag, SWITCH_225: flag, SWITCH_226: flag, SWITCH_227: flag, SWITCH_228: flag, SWITCH_229: flag, SWITCH_230: flag, SWITCH_231: flag, SWITCH_232: flag, SWITCH_233: flag, SWITCH_234: flag, SWITCH_235: flag, SWITCH_236: flag, SWITCH_237: flag, SWITCH_238: flag, SWITCH_239: flag, SWITCH_240: flag, SWITCH_241: flag, SWITCH_242: flag, SWITCH_243: flag, SWITCH_244: flag, SWITCH_245: flag, SWITCH_246: flag, SWITCH_247: flag, SWITCH_248: flag, SWITCH_249: flag, SWITCH_250: flag, SWITCH_251: flag, SWITCH_252: flag, SWITCH_253: flag, SWITCH_254: flag, SWITCH_255: flag, SWITCH_256: flag, SWITCH_257: flag, SWITCH_258: flag, SWITCH_259: flag, SWITCH_260: flag, SWITCH_261: flag, SWITCH_262: flag, SWITCH_263: flag, SWITCH_264: flag, SWITCH_265: flag, SWITCH_266: flag, SWITCH_267: flag, SWITCH_268: flag, SWITCH_269: flag, SWITCH_270: flag, SWITCH_271: flag, SWITCH_272: flag, SWITCH_273: flag, SWITCH_274: flag, SWITCH_275: flag, SWITCH_276: flag, SWITCH_277: flag, SWITCH_278: flag, SWITCH_279: flag, SWITCH_280: flag, SWITCH_281: flag, SWITCH_282: flag, SWITCH_283: flag, SWITCH_284: flag, SWITCH_285: flag, SWITCH_286: flag, SWITCH_287: flag, SWITCH_288: flag, SWITCH_289: flag, SWITCH_290: flag, SWITCH_291: flag, SWITCH_292: flag, SWITCH_293: flag, SWITCH_294: flag, SWITCH_295: flag, SWITCH_296: flag, SWITCH_297: flag, SWITCH_298: flag, SWITCH_299: flag, SWITCH_300: flag, SWITCH_301: flag, SWITCH_302: flag, SWITCH_303: flag, SWITCH_304: flag, SWITCH_305: flag, SWITCH_306: flag, SWITCH_307: flag, SWITCH_308: flag, SWITCH_309: flag, SWITCH_310: flag, SWITCH_311: flag, SWITCH_312: flag, SWITCH_313: flag, SWITCH_314: flag, SWITCH_315: flag, SWITCH_316: flag, SWITCH_317: flag, SWITCH_318: flag, SWITCH_319: flag, SWITCH_320: flag, SWITCH_321: flag, SWITCH_322: flag, SWITCH_323: flag, SWITCH_324: flag, SWITCH_325: flag, SWITCH_326: flag, SWITCH_327: flag, SWITCH_328: flag, SWITCH_329: flag, SWITCH_330: flag, SWITCH_331: flag, SWITCH_332: flag, SWITCH_333: flag, SWITCH_334: flag, SWITCH_335: flag, SWITCH_336: flag, SWITCH_337: flag, SWITCH_338: flag, SWITCH_339: flag, SWITCH_340: flag, SWITCH_341: flag, SWITCH_342: flag, SWITCH_343: flag, SWITCH_344: flag, SWITCH_345: flag, SWITCH_346: flag, SWITCH_347: flag, SWITCH_348: flag, SWITCH_349: flag, SWITCH_350: flag, SWITCH_351: flag, SWITCH_352: flag, SWITCH_353: flag, SWITCH_354: flag, SWITCH_355: flag, SWITCH_356: flag, SWITCH_357: flag, SWITCH_358: flag, SWITCH_359: flag, SWITCH_360: flag, SWITCH_361: flag, SWITCH_362: flag, SWITCH_363: flag, SWITCH_364: flag, SWITCH_365: flag, SWITCH_366: flag, SWITCH_367: flag, SWITCH_368: flag, SWITCH_369: flag, SWITCH_370: flag, SWITCH_371: flag, SWITCH_372: flag, SWITCH_373: flag, SWITCH_374: flag, SWITCH_375: flag, SWITCH_376: flag, SWITCH_377: flag, SWITCH_378: flag, SWITCH_379: flag, SWITCH_380: flag, SWITCH_381: flag, SWITCH_382: flag, SWITCH_383: flag, SWITCH_384: flag, SWITCH_385: flag, SWITCH_386: flag, SWITCH_387: flag, SWITCH_388: flag, SWITCH_389: flag, SWITCH_390: flag, SWITCH_391: flag, SWITCH_392: flag, SWITCH_393: flag, SWITCH_394: flag, SWITCH_395: flag, SWITCH_396: flag, SWITCH_397: flag, SWITCH_398: flag, SWITCH_399: flag, SWITCH_400: flag, SWITCH_401: flag, SWITCH_402: flag, SWITCH_403: flag, SWITCH_404: flag, SWITCH_405: flag, SWITCH_406: flag, SWITCH_407: flag, SWITCH_408: flag, SWITCH_409: flag, SWITCH_410: flag, SWITCH_411: flag, SWITCH_412: flag, SWITCH_413: flag, SWITCH_414: flag, SWITCH_415: flag, SWITCH_416: flag, SWITCH_417: flag, SWITCH_418: flag, SWITCH_419: flag, SWITCH_420: flag, SWITCH_421: flag, SWITCH_422: flag, SWITCH_423: flag, SWITCH_424: flag, SWITCH_425: flag, SWITCH_426: flag, SWITCH_427: flag, SWITCH_428: flag, SWITCH_429: flag, SWITCH_430: flag, SWITCH_431: flag, SWITCH_432: flag, SWITCH_433: flag, SWITCH_434: flag, SWITCH_435: flag, SWITCH_436: flag, SWITCH_437: flag, SWITCH_438: flag, SWITCH_439: flag, SWITCH_440: flag, SWITCH_441: flag, SWITCH_442: flag, SWITCH_443: flag, SWITCH_444: flag, SWITCH_445: flag, SWITCH_446: flag, SWITCH_447: flag, SWITCH_448: flag, SWITCH_449: flag, SWITCH_450: flag, SWITCH_451: flag, SWITCH_452: flag, SWITCH_453: flag, SWITCH_454: flag, SWITCH_455: flag, SWITCH_456: flag, SWITCH_457: flag, SWITCH_458: flag, SWITCH_459: flag, SWITCH_460: flag, SWITCH_461: flag, SWITCH_462: flag, SWITCH_463: flag, SWITCH_464: flag, SWITCH_465: flag, SWITCH_466: flag, SWITCH_467: flag, SWITCH_468: flag, SWITCH_469: flag, SWITCH_470: flag, SWITCH_471: flag, SWITCH_472: flag, SWITCH_473: flag, SWITCH_474: flag, SWITCH_475: flag, SWITCH_476: flag, SWITCH_477: flag, SWITCH_478: flag, SWITCH_479: flag, SWITCH_480: flag, SWITCH_481: flag, SWITCH_482: flag, SWITCH_483: flag, SWITCH_484: flag, SWITCH_485: flag, SWITCH_486: flag, SWITCH_487: flag, SWITCH_488: flag, SWITCH_489: flag, SWITCH_490: flag, SWITCH_491: flag, SWITCH_492: flag, SWITCH_493: flag, SWITCH_494: flag, SWITCH_495: flag, SWITCH_496: flag, SWITCH_497: flag, SWITCH_498: flag, SWITCH_499: flag, SWITCH_500: flag, SWITCH_501: flag, SWITCH_502: flag, SWITCH_503: flag, SWITCH_504: flag, SWITCH_505: flag, SWITCH_506: flag, SWITCH_507: flag, SWITCH_508: flag, SWITCH_509: flag, SWITCH_510: flag, SWITCH_511: flag, SWITCH_512: flag, SWITCH_513: flag, SWITCH_514: flag, SWITCH_515: flag, SWITCH_516: flag, SWITCH_517: flag, SWITCH_518: flag, SWITCH_519: flag, SWITCH_520: flag, SWITCH_521: flag, SWITCH_522: flag, SWITCH_523: flag, SWITCH_524: flag, SWITCH_525: flag, SWITCH_526: flag, SWITCH_527: flag, SWITCH_528: flag, SWITCH_529: flag, SWITCH_530: flag, SWITCH_531: flag, SWITCH_532: flag, SWITCH_533: flag, SWITCH_534: flag, SWITCH_535: flag, SWITCH_536: flag, SWITCH_537: flag, SWITCH_538: flag, SWITCH_539: flag, SWITCH_540: flag, SWITCH_541: flag, SWITCH_542: flag, SWITCH_543: flag, SWITCH_544: flag, SWITCH_545: flag, SWITCH_546: flag, SWITCH_547: flag, SWITCH_548: flag, SWITCH_549: flag, SWITCH_550: flag, SWITCH_551: flag, SWITCH_552: flag, SWITCH_553: flag, SWITCH_554: flag, SWITCH_555: flag, SWITCH_556: flag, SWITCH_557: flag, SWITCH_558: flag, SWITCH_559: flag, SWITCH_560: flag, SWITCH_561: flag, SWITCH_562: flag, SWITCH_563: flag, SWITCH_564: flag, SWITCH_565: flag, SWITCH_566: flag, SWITCH_567: flag, SWITCH_568: flag, SWITCH_569: flag, SWITCH_570: flag, SWITCH_571: flag, SWITCH_572: flag, SWITCH_573: flag, SWITCH_574: flag, SWITCH_575: flag, SWITCH_576: flag, SWITCH_577: flag, SWITCH_578: flag, SWITCH_579: flag, SWITCH_580: flag, SWITCH_581: flag, SWITCH_582: flag, SWITCH_583: flag, SWITCH_584: flag, SWITCH_585: flag, SWITCH_586: flag, SWITCH_587: flag, SWITCH_588: flag, SWITCH_589: flag, SWITCH_590: flag, SWITCH_591: flag, SWITCH_592: flag, SWITCH_593: flag, SWITCH_594: flag, SWITCH_595: flag, SWITCH_596: flag, SWITCH_597: flag, SWITCH_598: flag, SWITCH_599: flag };
const numbers = { SHLVL: count, NOT_THERE_4: count };
const SHAPE = { ...paths, ...switches, ...numbers };
const OTHER_SHAPE = { LANG: text, NOT_THERE_5: flag };
const shapes = new WeakMap<object, Record<string, Field> | null>();

function getterFor(key: string, field: Field, unread: object): () => unknown {
  let lastRaw: unknown = unread;
  let lastParsed: unknown;
  return () => {
    const raw = process.env[key];
    if (raw !== lastRaw) {
      lastParsed = field.parse(raw);
      lastRaw = raw;
    }
    return lastParsed;
  };
}
function isShapeKey(shape: Record<string, Field>, key: string | symbol): key is string {
  return typeof key === "string" && Object.hasOwn(shape, key);
}
function lazyAccessor(shape: Record<string, Field>, proto: object | null): Record<string, unknown> {
  const keys = new Proxy(Object.create(proto), {
    get: (target, key, receiver) => {
      if (!isShapeKey(shape, key)) return Reflect.get(target, key, receiver);
      const read = getterFor(key, shape[key]!, accessor);
      if (receiver === accessor) Object.defineProperty(accessor, key, { get: read, configurable: true });
      return read();
    },
    has: (target, key) => isShapeKey(shape, key) || Reflect.has(target, key),
  });
  const accessor: Record<string, unknown> = Object.create(keys);
  return accessor;
}
function build(shape: Record<string, Field>, proto: object | null, lazy = switches.LAZY_GETTERS.parse(process.env["LAZY_GETTERS"]) === true): Record<string, unknown> {
  const accessor = lazy ? lazyAccessor(shape, proto) : (Object.create(proto) as Record<string, unknown>);
  for (const [key, field] of lazy ? [] : Object.entries(shape)) {
    Object.defineProperty(accessor, key, { get: getterFor(key, field, accessor), enumerable: true, configurable: true });
  }
  shapes.set(accessor, lazy ? shape : null);
  Object.defineProperties(accessor, {
    set: { value: (key: string, value: string | number | boolean) => { process.env[key] = String(value); } },
    unset: { value: (key: string) => { delete process.env[key]; } },
  });
  return accessor;
}
const runtime = { platform: process.platform, isCI: false };
type Settings = { HOME: string; PATH: string; USER: string; NOT_THERE_1: boolean; NOT_THERE_2: boolean; NOT_THERE_3: boolean; LAZY_GETTERS: boolean; SWITCH_0: boolean; SWITCH_1: boolean; SWITCH_2: boolean; SWITCH_3: boolean; SWITCH_4: boolean; SWITCH_5: boolean; SWITCH_6: boolean; SWITCH_7: boolean; SWITCH_8: boolean; SWITCH_9: boolean; SWITCH_10: boolean; SWITCH_11: boolean; SWITCH_12: boolean; SWITCH_13: boolean; SWITCH_14: boolean; SWITCH_15: boolean; SWITCH_16: boolean; SWITCH_17: boolean; SWITCH_18: boolean; SWITCH_19: boolean; SWITCH_20: boolean; SWITCH_21: boolean; SWITCH_22: boolean; SWITCH_23: boolean; SWITCH_24: boolean; SWITCH_25: boolean; SWITCH_26: boolean; SWITCH_27: boolean; SWITCH_28: boolean; SWITCH_29: boolean; SWITCH_30: boolean; SWITCH_31: boolean; SWITCH_32: boolean; SWITCH_33: boolean; SWITCH_34: boolean; SWITCH_35: boolean; SWITCH_36: boolean; SWITCH_37: boolean; SWITCH_38: boolean; SWITCH_39: boolean; SWITCH_40: boolean; SWITCH_41: boolean; SWITCH_42: boolean; SWITCH_43: boolean; SWITCH_44: boolean; SWITCH_45: boolean; SWITCH_46: boolean; SWITCH_47: boolean; SWITCH_48: boolean; SWITCH_49: boolean; SWITCH_50: boolean; SWITCH_51: boolean; SWITCH_52: boolean; SWITCH_53: boolean; SWITCH_54: boolean; SWITCH_55: boolean; SWITCH_56: boolean; SWITCH_57: boolean; SWITCH_58: boolean; SWITCH_59: boolean; SWITCH_60: boolean; SWITCH_61: boolean; SWITCH_62: boolean; SWITCH_63: boolean; SWITCH_64: boolean; SWITCH_65: boolean; SWITCH_66: boolean; SWITCH_67: boolean; SWITCH_68: boolean; SWITCH_69: boolean; SWITCH_70: boolean; SWITCH_71: boolean; SWITCH_72: boolean; SWITCH_73: boolean; SWITCH_74: boolean; SWITCH_75: boolean; SWITCH_76: boolean; SWITCH_77: boolean; SWITCH_78: boolean; SWITCH_79: boolean; SWITCH_80: boolean; SWITCH_81: boolean; SWITCH_82: boolean; SWITCH_83: boolean; SWITCH_84: boolean; SWITCH_85: boolean; SWITCH_86: boolean; SWITCH_87: boolean; SWITCH_88: boolean; SWITCH_89: boolean; SWITCH_90: boolean; SWITCH_91: boolean; SWITCH_92: boolean; SWITCH_93: boolean; SWITCH_94: boolean; SWITCH_95: boolean; SWITCH_96: boolean; SWITCH_97: boolean; SWITCH_98: boolean; SWITCH_99: boolean; SWITCH_100: boolean; SWITCH_101: boolean; SWITCH_102: boolean; SWITCH_103: boolean; SWITCH_104: boolean; SWITCH_105: boolean; SWITCH_106: boolean; SWITCH_107: boolean; SWITCH_108: boolean; SWITCH_109: boolean; SWITCH_110: boolean; SWITCH_111: boolean; SWITCH_112: boolean; SWITCH_113: boolean; SWITCH_114: boolean; SWITCH_115: boolean; SWITCH_116: boolean; SWITCH_117: boolean; SWITCH_118: boolean; SWITCH_119: boolean; SWITCH_120: boolean; SWITCH_121: boolean; SWITCH_122: boolean; SWITCH_123: boolean; SWITCH_124: boolean; SWITCH_125: boolean; SWITCH_126: boolean; SWITCH_127: boolean; SWITCH_128: boolean; SWITCH_129: boolean; SWITCH_130: boolean; SWITCH_131: boolean; SWITCH_132: boolean; SWITCH_133: boolean; SWITCH_134: boolean; SWITCH_135: boolean; SWITCH_136: boolean; SWITCH_137: boolean; SWITCH_138: boolean; SWITCH_139: boolean; SWITCH_140: boolean; SWITCH_141: boolean; SWITCH_142: boolean; SWITCH_143: boolean; SWITCH_144: boolean; SWITCH_145: boolean; SWITCH_146: boolean; SWITCH_147: boolean; SWITCH_148: boolean; SWITCH_149: boolean; SWITCH_150: boolean; SWITCH_151: boolean; SWITCH_152: boolean; SWITCH_153: boolean; SWITCH_154: boolean; SWITCH_155: boolean; SWITCH_156: boolean; SWITCH_157: boolean; SWITCH_158: boolean; SWITCH_159: boolean; SWITCH_160: boolean; SWITCH_161: boolean; SWITCH_162: boolean; SWITCH_163: boolean; SWITCH_164: boolean; SWITCH_165: boolean; SWITCH_166: boolean; SWITCH_167: boolean; SWITCH_168: boolean; SWITCH_169: boolean; SWITCH_170: boolean; SWITCH_171: boolean; SWITCH_172: boolean; SWITCH_173: boolean; SWITCH_174: boolean; SWITCH_175: boolean; SWITCH_176: boolean; SWITCH_177: boolean; SWITCH_178: boolean; SWITCH_179: boolean; SWITCH_180: boolean; SWITCH_181: boolean; SWITCH_182: boolean; SWITCH_183: boolean; SWITCH_184: boolean; SWITCH_185: boolean; SWITCH_186: boolean; SWITCH_187: boolean; SWITCH_188: boolean; SWITCH_189: boolean; SWITCH_190: boolean; SWITCH_191: boolean; SWITCH_192: boolean; SWITCH_193: boolean; SWITCH_194: boolean; SWITCH_195: boolean; SWITCH_196: boolean; SWITCH_197: boolean; SWITCH_198: boolean; SWITCH_199: boolean; SWITCH_200: boolean; SWITCH_201: boolean; SWITCH_202: boolean; SWITCH_203: boolean; SWITCH_204: boolean; SWITCH_205: boolean; SWITCH_206: boolean; SWITCH_207: boolean; SWITCH_208: boolean; SWITCH_209: boolean; SWITCH_210: boolean; SWITCH_211: boolean; SWITCH_212: boolean; SWITCH_213: boolean; SWITCH_214: boolean; SWITCH_215: boolean; SWITCH_216: boolean; SWITCH_217: boolean; SWITCH_218: boolean; SWITCH_219: boolean; SWITCH_220: boolean; SWITCH_221: boolean; SWITCH_222: boolean; SWITCH_223: boolean; SWITCH_224: boolean; SWITCH_225: boolean; SWITCH_226: boolean; SWITCH_227: boolean; SWITCH_228: boolean; SWITCH_229: boolean; SWITCH_230: boolean; SWITCH_231: boolean; SWITCH_232: boolean; SWITCH_233: boolean; SWITCH_234: boolean; SWITCH_235: boolean; SWITCH_236: boolean; SWITCH_237: boolean; SWITCH_238: boolean; SWITCH_239: boolean; SWITCH_240: boolean; SWITCH_241: boolean; SWITCH_242: boolean; SWITCH_243: boolean; SWITCH_244: boolean; SWITCH_245: boolean; SWITCH_246: boolean; SWITCH_247: boolean; SWITCH_248: boolean; SWITCH_249: boolean; SWITCH_250: boolean; SWITCH_251: boolean; SWITCH_252: boolean; SWITCH_253: boolean; SWITCH_254: boolean; SWITCH_255: boolean; SWITCH_256: boolean; SWITCH_257: boolean; SWITCH_258: boolean; SWITCH_259: boolean; SWITCH_260: boolean; SWITCH_261: boolean; SWITCH_262: boolean; SWITCH_263: boolean; SWITCH_264: boolean; SWITCH_265: boolean; SWITCH_266: boolean; SWITCH_267: boolean; SWITCH_268: boolean; SWITCH_269: boolean; SWITCH_270: boolean; SWITCH_271: boolean; SWITCH_272: boolean; SWITCH_273: boolean; SWITCH_274: boolean; SWITCH_275: boolean; SWITCH_276: boolean; SWITCH_277: boolean; SWITCH_278: boolean; SWITCH_279: boolean; SWITCH_280: boolean; SWITCH_281: boolean; SWITCH_282: boolean; SWITCH_283: boolean; SWITCH_284: boolean; SWITCH_285: boolean; SWITCH_286: boolean; SWITCH_287: boolean; SWITCH_288: boolean; SWITCH_289: boolean; SWITCH_290: boolean; SWITCH_291: boolean; SWITCH_292: boolean; SWITCH_293: boolean; SWITCH_294: boolean; SWITCH_295: boolean; SWITCH_296: boolean; SWITCH_297: boolean; SWITCH_298: boolean; SWITCH_299: boolean; SWITCH_300: boolean; SWITCH_301: boolean; SWITCH_302: boolean; SWITCH_303: boolean; SWITCH_304: boolean; SWITCH_305: boolean; SWITCH_306: boolean; SWITCH_307: boolean; SWITCH_308: boolean; SWITCH_309: boolean; SWITCH_310: boolean; SWITCH_311: boolean; SWITCH_312: boolean; SWITCH_313: boolean; SWITCH_314: boolean; SWITCH_315: boolean; SWITCH_316: boolean; SWITCH_317: boolean; SWITCH_318: boolean; SWITCH_319: boolean; SWITCH_320: boolean; SWITCH_321: boolean; SWITCH_322: boolean; SWITCH_323: boolean; SWITCH_324: boolean; SWITCH_325: boolean; SWITCH_326: boolean; SWITCH_327: boolean; SWITCH_328: boolean; SWITCH_329: boolean; SWITCH_330: boolean; SWITCH_331: boolean; SWITCH_332: boolean; SWITCH_333: boolean; SWITCH_334: boolean; SWITCH_335: boolean; SWITCH_336: boolean; SWITCH_337: boolean; SWITCH_338: boolean; SWITCH_339: boolean; SWITCH_340: boolean; SWITCH_341: boolean; SWITCH_342: boolean; SWITCH_343: boolean; SWITCH_344: boolean; SWITCH_345: boolean; SWITCH_346: boolean; SWITCH_347: boolean; SWITCH_348: boolean; SWITCH_349: boolean; SWITCH_350: boolean; SWITCH_351: boolean; SWITCH_352: boolean; SWITCH_353: boolean; SWITCH_354: boolean; SWITCH_355: boolean; SWITCH_356: boolean; SWITCH_357: boolean; SWITCH_358: boolean; SWITCH_359: boolean; SWITCH_360: boolean; SWITCH_361: boolean; SWITCH_362: boolean; SWITCH_363: boolean; SWITCH_364: boolean; SWITCH_365: boolean; SWITCH_366: boolean; SWITCH_367: boolean; SWITCH_368: boolean; SWITCH_369: boolean; SWITCH_370: boolean; SWITCH_371: boolean; SWITCH_372: boolean; SWITCH_373: boolean; SWITCH_374: boolean; SWITCH_375: boolean; SWITCH_376: boolean; SWITCH_377: boolean; SWITCH_378: boolean; SWITCH_379: boolean; SWITCH_380: boolean; SWITCH_381: boolean; SWITCH_382: boolean; SWITCH_383: boolean; SWITCH_384: boolean; SWITCH_385: boolean; SWITCH_386: boolean; SWITCH_387: boolean; SWITCH_388: boolean; SWITCH_389: boolean; SWITCH_390: boolean; SWITCH_391: boolean; SWITCH_392: boolean; SWITCH_393: boolean; SWITCH_394: boolean; SWITCH_395: boolean; SWITCH_396: boolean; SWITCH_397: boolean; SWITCH_398: boolean; SWITCH_399: boolean; SWITCH_400: boolean; SWITCH_401: boolean; SWITCH_402: boolean; SWITCH_403: boolean; SWITCH_404: boolean; SWITCH_405: boolean; SWITCH_406: boolean; SWITCH_407: boolean; SWITCH_408: boolean; SWITCH_409: boolean; SWITCH_410: boolean; SWITCH_411: boolean; SWITCH_412: boolean; SWITCH_413: boolean; SWITCH_414: boolean; SWITCH_415: boolean; SWITCH_416: boolean; SWITCH_417: boolean; SWITCH_418: boolean; SWITCH_419: boolean; SWITCH_420: boolean; SWITCH_421: boolean; SWITCH_422: boolean; SWITCH_423: boolean; SWITCH_424: boolean; SWITCH_425: boolean; SWITCH_426: boolean; SWITCH_427: boolean; SWITCH_428: boolean; SWITCH_429: boolean; SWITCH_430: boolean; SWITCH_431: boolean; SWITCH_432: boolean; SWITCH_433: boolean; SWITCH_434: boolean; SWITCH_435: boolean; SWITCH_436: boolean; SWITCH_437: boolean; SWITCH_438: boolean; SWITCH_439: boolean; SWITCH_440: boolean; SWITCH_441: boolean; SWITCH_442: boolean; SWITCH_443: boolean; SWITCH_444: boolean; SWITCH_445: boolean; SWITCH_446: boolean; SWITCH_447: boolean; SWITCH_448: boolean; SWITCH_449: boolean; SWITCH_450: boolean; SWITCH_451: boolean; SWITCH_452: boolean; SWITCH_453: boolean; SWITCH_454: boolean; SWITCH_455: boolean; SWITCH_456: boolean; SWITCH_457: boolean; SWITCH_458: boolean; SWITCH_459: boolean; SWITCH_460: boolean; SWITCH_461: boolean; SWITCH_462: boolean; SWITCH_463: boolean; SWITCH_464: boolean; SWITCH_465: boolean; SWITCH_466: boolean; SWITCH_467: boolean; SWITCH_468: boolean; SWITCH_469: boolean; SWITCH_470: boolean; SWITCH_471: boolean; SWITCH_472: boolean; SWITCH_473: boolean; SWITCH_474: boolean; SWITCH_475: boolean; SWITCH_476: boolean; SWITCH_477: boolean; SWITCH_478: boolean; SWITCH_479: boolean; SWITCH_480: boolean; SWITCH_481: boolean; SWITCH_482: boolean; SWITCH_483: boolean; SWITCH_484: boolean; SWITCH_485: boolean; SWITCH_486: boolean; SWITCH_487: boolean; SWITCH_488: boolean; SWITCH_489: boolean; SWITCH_490: boolean; SWITCH_491: boolean; SWITCH_492: boolean; SWITCH_493: boolean; SWITCH_494: boolean; SWITCH_495: boolean; SWITCH_496: boolean; SWITCH_497: boolean; SWITCH_498: boolean; SWITCH_499: boolean; SWITCH_500: boolean; SWITCH_501: boolean; SWITCH_502: boolean; SWITCH_503: boolean; SWITCH_504: boolean; SWITCH_505: boolean; SWITCH_506: boolean; SWITCH_507: boolean; SWITCH_508: boolean; SWITCH_509: boolean; SWITCH_510: boolean; SWITCH_511: boolean; SWITCH_512: boolean; SWITCH_513: boolean; SWITCH_514: boolean; SWITCH_515: boolean; SWITCH_516: boolean; SWITCH_517: boolean; SWITCH_518: boolean; SWITCH_519: boolean; SWITCH_520: boolean; SWITCH_521: boolean; SWITCH_522: boolean; SWITCH_523: boolean; SWITCH_524: boolean; SWITCH_525: boolean; SWITCH_526: boolean; SWITCH_527: boolean; SWITCH_528: boolean; SWITCH_529: boolean; SWITCH_530: boolean; SWITCH_531: boolean; SWITCH_532: boolean; SWITCH_533: boolean; SWITCH_534: boolean; SWITCH_535: boolean; SWITCH_536: boolean; SWITCH_537: boolean; SWITCH_538: boolean; SWITCH_539: boolean; SWITCH_540: boolean; SWITCH_541: boolean; SWITCH_542: boolean; SWITCH_543: boolean; SWITCH_544: boolean; SWITCH_545: boolean; SWITCH_546: boolean; SWITCH_547: boolean; SWITCH_548: boolean; SWITCH_549: boolean; SWITCH_550: boolean; SWITCH_551: boolean; SWITCH_552: boolean; SWITCH_553: boolean; SWITCH_554: boolean; SWITCH_555: boolean; SWITCH_556: boolean; SWITCH_557: boolean; SWITCH_558: boolean; SWITCH_559: boolean; SWITCH_560: boolean; SWITCH_561: boolean; SWITCH_562: boolean; SWITCH_563: boolean; SWITCH_564: boolean; SWITCH_565: boolean; SWITCH_566: boolean; SWITCH_567: boolean; SWITCH_568: boolean; SWITCH_569: boolean; SWITCH_570: boolean; SWITCH_571: boolean; SWITCH_572: boolean; SWITCH_573: boolean; SWITCH_574: boolean; SWITCH_575: boolean; SWITCH_576: boolean; SWITCH_577: boolean; SWITCH_578: boolean; SWITCH_579: boolean; SWITCH_580: boolean; SWITCH_581: boolean; SWITCH_582: boolean; SWITCH_583: boolean; SWITCH_584: boolean; SWITCH_585: boolean; SWITCH_586: boolean; SWITCH_587: boolean; SWITCH_588: boolean; SWITCH_589: boolean; SWITCH_590: boolean; SWITCH_591: boolean; SWITCH_592: boolean; SWITCH_593: boolean; SWITCH_594: boolean; SWITCH_595: boolean; SWITCH_596: boolean; SWITCH_597: boolean; SWITCH_598: boolean; SWITCH_599: boolean; SHLVL: number | undefined; NOT_THERE_4: number | undefined } & typeof runtime & { set(key: string, value: string): void; unset(key: string): void };
const settings = build(SHAPE, runtime) as Settings;
const other = build(OTHER_SHAPE, null) as { LANG: string; NOT_THERE_5: boolean };

const howMany = Number(process.argv[2] ?? 600) | 0;
let seen = 0;`,
      [600, n => `if (howMany > ${n} && settings.SWITCH_${n}) seen++;`],
      `console.log(seen, howMany);
`,
    ),
    "six-hundred-accessors-defined-by-a-loop.ts": text(
      `// Many names: what it costs to build an object of 600 accessors in a loop, and to read each of them once.
type Field = { parse(raw: string | undefined): unknown };
const text: Field = { parse: raw => raw };
const flag: Field = { parse: raw => raw === "1" || raw === "true" };
const part0 = { NAME_0: text, NAME_1: flag, NAME_2: text, NAME_3: flag, NAME_4: text, NAME_5: flag, NAME_6: text, NAME_7: flag, NAME_8: text, NAME_9: flag, NAME_10: text, NAME_11: flag, NAME_12: text, NAME_13: flag, NAME_14: text, NAME_15: flag, NAME_16: text, NAME_17: flag, NAME_18: text, NAME_19: flag, NAME_20: text, NAME_21: flag, NAME_22: text, NAME_23: flag, NAME_24: text, NAME_25: flag, NAME_26: text, NAME_27: flag, NAME_28: text, NAME_29: flag, NAME_30: text, NAME_31: flag, NAME_32: text, NAME_33: flag, NAME_34: text, NAME_35: flag, NAME_36: text, NAME_37: flag, NAME_38: text, NAME_39: flag, NAME_40: text, NAME_41: flag, NAME_42: text, NAME_43: flag, NAME_44: text, NAME_45: flag, NAME_46: text, NAME_47: flag, NAME_48: text, NAME_49: flag, NAME_50: text, NAME_51: flag, NAME_52: text, NAME_53: flag, NAME_54: text, NAME_55: flag, NAME_56: text, NAME_57: flag, NAME_58: text, NAME_59: flag, NAME_60: text, NAME_61: flag, NAME_62: text, NAME_63: flag, NAME_64: text, NAME_65: flag, NAME_66: text, NAME_67: flag, NAME_68: text, NAME_69: flag, NAME_70: text, NAME_71: flag, NAME_72: text, NAME_73: flag, NAME_74: text, NAME_75: flag, NAME_76: text, NAME_77: flag, NAME_78: text, NAME_79: flag, NAME_80: text, NAME_81: flag, NAME_82: text, NAME_83: flag, NAME_84: text, NAME_85: flag, NAME_86: text, NAME_87: flag, NAME_88: text, NAME_89: flag, NAME_90: text, NAME_91: flag, NAME_92: text, NAME_93: flag, NAME_94: text, NAME_95: flag, NAME_96: text, NAME_97: flag, NAME_98: text, NAME_99: flag };
const part1 = { NAME_100: text, NAME_101: flag, NAME_102: text, NAME_103: flag, NAME_104: text, NAME_105: flag, NAME_106: text, NAME_107: flag, NAME_108: text, NAME_109: flag, NAME_110: text, NAME_111: flag, NAME_112: text, NAME_113: flag, NAME_114: text, NAME_115: flag, NAME_116: text, NAME_117: flag, NAME_118: text, NAME_119: flag, NAME_120: text, NAME_121: flag, NAME_122: text, NAME_123: flag, NAME_124: text, NAME_125: flag, NAME_126: text, NAME_127: flag, NAME_128: text, NAME_129: flag, NAME_130: text, NAME_131: flag, NAME_132: text, NAME_133: flag, NAME_134: text, NAME_135: flag, NAME_136: text, NAME_137: flag, NAME_138: text, NAME_139: flag, NAME_140: text, NAME_141: flag, NAME_142: text, NAME_143: flag, NAME_144: text, NAME_145: flag, NAME_146: text, NAME_147: flag, NAME_148: text, NAME_149: flag, NAME_150: text, NAME_151: flag, NAME_152: text, NAME_153: flag, NAME_154: text, NAME_155: flag, NAME_156: text, NAME_157: flag, NAME_158: text, NAME_159: flag, NAME_160: text, NAME_161: flag, NAME_162: text, NAME_163: flag, NAME_164: text, NAME_165: flag, NAME_166: text, NAME_167: flag, NAME_168: text, NAME_169: flag, NAME_170: text, NAME_171: flag, NAME_172: text, NAME_173: flag, NAME_174: text, NAME_175: flag, NAME_176: text, NAME_177: flag, NAME_178: text, NAME_179: flag, NAME_180: text, NAME_181: flag, NAME_182: text, NAME_183: flag, NAME_184: text, NAME_185: flag, NAME_186: text, NAME_187: flag, NAME_188: text, NAME_189: flag, NAME_190: text, NAME_191: flag, NAME_192: text, NAME_193: flag, NAME_194: text, NAME_195: flag, NAME_196: text, NAME_197: flag, NAME_198: text, NAME_199: flag };
const part2 = { NAME_200: text, NAME_201: flag, NAME_202: text, NAME_203: flag, NAME_204: text, NAME_205: flag, NAME_206: text, NAME_207: flag, NAME_208: text, NAME_209: flag, NAME_210: text, NAME_211: flag, NAME_212: text, NAME_213: flag, NAME_214: text, NAME_215: flag, NAME_216: text, NAME_217: flag, NAME_218: text, NAME_219: flag, NAME_220: text, NAME_221: flag, NAME_222: text, NAME_223: flag, NAME_224: text, NAME_225: flag, NAME_226: text, NAME_227: flag, NAME_228: text, NAME_229: flag, NAME_230: text, NAME_231: flag, NAME_232: text, NAME_233: flag, NAME_234: text, NAME_235: flag, NAME_236: text, NAME_237: flag, NAME_238: text, NAME_239: flag, NAME_240: text, NAME_241: flag, NAME_242: text, NAME_243: flag, NAME_244: text, NAME_245: flag, NAME_246: text, NAME_247: flag, NAME_248: text, NAME_249: flag, NAME_250: text, NAME_251: flag, NAME_252: text, NAME_253: flag, NAME_254: text, NAME_255: flag, NAME_256: text, NAME_257: flag, NAME_258: text, NAME_259: flag, NAME_260: text, NAME_261: flag, NAME_262: text, NAME_263: flag, NAME_264: text, NAME_265: flag, NAME_266: text, NAME_267: flag, NAME_268: text, NAME_269: flag, NAME_270: text, NAME_271: flag, NAME_272: text, NAME_273: flag, NAME_274: text, NAME_275: flag, NAME_276: text, NAME_277: flag, NAME_278: text, NAME_279: flag, NAME_280: text, NAME_281: flag, NAME_282: text, NAME_283: flag, NAME_284: text, NAME_285: flag, NAME_286: text, NAME_287: flag, NAME_288: text, NAME_289: flag, NAME_290: text, NAME_291: flag, NAME_292: text, NAME_293: flag, NAME_294: text, NAME_295: flag, NAME_296: text, NAME_297: flag, NAME_298: text, NAME_299: flag };
const part3 = { NAME_300: text, NAME_301: flag, NAME_302: text, NAME_303: flag, NAME_304: text, NAME_305: flag, NAME_306: text, NAME_307: flag, NAME_308: text, NAME_309: flag, NAME_310: text, NAME_311: flag, NAME_312: text, NAME_313: flag, NAME_314: text, NAME_315: flag, NAME_316: text, NAME_317: flag, NAME_318: text, NAME_319: flag, NAME_320: text, NAME_321: flag, NAME_322: text, NAME_323: flag, NAME_324: text, NAME_325: flag, NAME_326: text, NAME_327: flag, NAME_328: text, NAME_329: flag, NAME_330: text, NAME_331: flag, NAME_332: text, NAME_333: flag, NAME_334: text, NAME_335: flag, NAME_336: text, NAME_337: flag, NAME_338: text, NAME_339: flag, NAME_340: text, NAME_341: flag, NAME_342: text, NAME_343: flag, NAME_344: text, NAME_345: flag, NAME_346: text, NAME_347: flag, NAME_348: text, NAME_349: flag, NAME_350: text, NAME_351: flag, NAME_352: text, NAME_353: flag, NAME_354: text, NAME_355: flag, NAME_356: text, NAME_357: flag, NAME_358: text, NAME_359: flag, NAME_360: text, NAME_361: flag, NAME_362: text, NAME_363: flag, NAME_364: text, NAME_365: flag, NAME_366: text, NAME_367: flag, NAME_368: text, NAME_369: flag, NAME_370: text, NAME_371: flag, NAME_372: text, NAME_373: flag, NAME_374: text, NAME_375: flag, NAME_376: text, NAME_377: flag, NAME_378: text, NAME_379: flag, NAME_380: text, NAME_381: flag, NAME_382: text, NAME_383: flag, NAME_384: text, NAME_385: flag, NAME_386: text, NAME_387: flag, NAME_388: text, NAME_389: flag, NAME_390: text, NAME_391: flag, NAME_392: text, NAME_393: flag, NAME_394: text, NAME_395: flag, NAME_396: text, NAME_397: flag, NAME_398: text, NAME_399: flag };
const part4 = { NAME_400: text, NAME_401: flag, NAME_402: text, NAME_403: flag, NAME_404: text, NAME_405: flag, NAME_406: text, NAME_407: flag, NAME_408: text, NAME_409: flag, NAME_410: text, NAME_411: flag, NAME_412: text, NAME_413: flag, NAME_414: text, NAME_415: flag, NAME_416: text, NAME_417: flag, NAME_418: text, NAME_419: flag, NAME_420: text, NAME_421: flag, NAME_422: text, NAME_423: flag, NAME_424: text, NAME_425: flag, NAME_426: text, NAME_427: flag, NAME_428: text, NAME_429: flag, NAME_430: text, NAME_431: flag, NAME_432: text, NAME_433: flag, NAME_434: text, NAME_435: flag, NAME_436: text, NAME_437: flag, NAME_438: text, NAME_439: flag, NAME_440: text, NAME_441: flag, NAME_442: text, NAME_443: flag, NAME_444: text, NAME_445: flag, NAME_446: text, NAME_447: flag, NAME_448: text, NAME_449: flag, NAME_450: text, NAME_451: flag, NAME_452: text, NAME_453: flag, NAME_454: text, NAME_455: flag, NAME_456: text, NAME_457: flag, NAME_458: text, NAME_459: flag, NAME_460: text, NAME_461: flag, NAME_462: text, NAME_463: flag, NAME_464: text, NAME_465: flag, NAME_466: text, NAME_467: flag, NAME_468: text, NAME_469: flag, NAME_470: text, NAME_471: flag, NAME_472: text, NAME_473: flag, NAME_474: text, NAME_475: flag, NAME_476: text, NAME_477: flag, NAME_478: text, NAME_479: flag, NAME_480: text, NAME_481: flag, NAME_482: text, NAME_483: flag, NAME_484: text, NAME_485: flag, NAME_486: text, NAME_487: flag, NAME_488: text, NAME_489: flag, NAME_490: text, NAME_491: flag, NAME_492: text, NAME_493: flag, NAME_494: text, NAME_495: flag, NAME_496: text, NAME_497: flag, NAME_498: text, NAME_499: flag };
const part5 = { NAME_500: text, NAME_501: flag, NAME_502: text, NAME_503: flag, NAME_504: text, NAME_505: flag, NAME_506: text, NAME_507: flag, NAME_508: text, NAME_509: flag, NAME_510: text, NAME_511: flag, NAME_512: text, NAME_513: flag, NAME_514: text, NAME_515: flag, NAME_516: text, NAME_517: flag, NAME_518: text, NAME_519: flag, NAME_520: text, NAME_521: flag, NAME_522: text, NAME_523: flag, NAME_524: text, NAME_525: flag, NAME_526: text, NAME_527: flag, NAME_528: text, NAME_529: flag, NAME_530: text, NAME_531: flag, NAME_532: text, NAME_533: flag, NAME_534: text, NAME_535: flag, NAME_536: text, NAME_537: flag, NAME_538: text, NAME_539: flag, NAME_540: text, NAME_541: flag, NAME_542: text, NAME_543: flag, NAME_544: text, NAME_545: flag, NAME_546: text, NAME_547: flag, NAME_548: text, NAME_549: flag, NAME_550: text, NAME_551: flag, NAME_552: text, NAME_553: flag, NAME_554: text, NAME_555: flag, NAME_556: text, NAME_557: flag, NAME_558: text, NAME_559: flag, NAME_560: text, NAME_561: flag, NAME_562: text, NAME_563: flag, NAME_564: text, NAME_565: flag, NAME_566: text, NAME_567: flag, NAME_568: text, NAME_569: flag, NAME_570: text, NAME_571: flag, NAME_572: text, NAME_573: flag, NAME_574: text, NAME_575: flag, NAME_576: text, NAME_577: flag, NAME_578: text, NAME_579: flag, NAME_580: text, NAME_581: flag, NAME_582: text, NAME_583: flag, NAME_584: text, NAME_585: flag, NAME_586: text, NAME_587: flag, NAME_588: text, NAME_589: flag, NAME_590: text, NAME_591: flag, NAME_592: text, NAME_593: flag, NAME_594: text, NAME_595: flag, NAME_596: text, NAME_597: flag, NAME_598: text, NAME_599: flag };
const shape = { ...part0, ...part1, ...part2, ...part3, ...part4, ...part5 };
function getterFor(key: string, field: Field): () => unknown {
  let lastRaw: string | undefined, lastParsed: unknown, isFirst = true;
  return () => {
    const raw = process.env[key];
    if (isFirst || raw !== lastRaw) { isFirst = false; lastRaw = raw; lastParsed = field.parse(raw); }
    return lastParsed;
  };
}
function build(fields: Record<string, Field>, proto: object | null) {
  const made = Object.create(proto) as Record<string, unknown>;
  for (const [key, field] of Object.entries(fields)) Object.defineProperty(made, key, { get: getterFor(key, field), enumerable: true, configurable: true });
  return made;
}
type Settings = { [K in keyof typeof shape]: unknown };
let settings = build(shape, null) as Settings;
function touch(): number {
  let n = 0;`,
      [600, n => `  if (settings.NAME_${n}) n++;`],
      `  return n;
}
const builds = Number(process.argv[2] ?? 2) | 0, touches = Number(process.argv[3] ?? 2) | 0;
let sum = 0;
for (let i = 0; i < builds; i++) settings = build(shape, null) as Settings;
for (let i = 0; i < touches; i++) sum += touch();
console.log(sum, Object.keys(settings).length);
`,
    ),
  });
