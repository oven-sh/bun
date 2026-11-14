// COUNTER: ReturnAddressTraceFallbacks <= 30
// COUNTER: operationAOTConstructWithArray <= 500
// Heirs of Error as Babel writes them for ES5, and Reflect.construct applied to the arguments of other functions.
function _getPrototypeOf(t) { return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) { return t.__proto__ || Object.getPrototypeOf(t); }, _getPrototypeOf(t); }
function _setPrototypeOf(t, e) { return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, _setPrototypeOf(t, e); }
function _isNativeFunction(t) { try { return -1 !== Function.toString.call(t).indexOf("[native code]"); } catch (n) { return "function" == typeof t; } }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} return (_isNativeReflectConstruct = function () { return !!t; })(); }
function _construct(t, e, r) { if (_isNativeReflectConstruct()) return Reflect.construct.apply(null, arguments); var o = [null]; o.push.apply(o, e); var p = new (t.bind.apply(t, o))(); return r && _setPrototypeOf(p, r.prototype), p; }
function _wrapNativeSuper(t) { var r = "function" == typeof Map ? new Map() : void 0; return _wrapNativeSuper = function (t) { if (null === t || !_isNativeFunction(t)) return t; if ("function" != typeof t) throw new TypeError("Super expression must either be null or a function"); if (void 0 !== r) { if (r.has(t)) return r.get(t); r.set(t, Wrapper); } function Wrapper() { return _construct(t, arguments, _getPrototypeOf(this).constructor); } return Wrapper.prototype = Object.create(t.prototype, { constructor: { value: Wrapper, enumerable: !1, writable: !0, configurable: !0 } }), _setPrototypeOf(Wrapper, t); }, _wrapNativeSuper(t); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }
function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); return e; }
function _possibleConstructorReturn(t, e) { if (e && ("object" == typeof e || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); return _assertThisInitialized(t); }
function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function shown(e) { return e.stack.split("\n").map(l => l.trim().replace(/\(.*\//, "(").replace(/:\d.*/, "")).join(" < "); }
function heirOf(parent) { return function (_Error) { function E(m, options) { var _this; _classCallCheck(this, E); _this = _callSuper(this, E, [m, options]); _this.code = 1; return _this; } _inherits(E, _Error); E.prototype.describe = function () { return this.name + " " + this.message + " " + this.code; }; return E; }(_wrapNativeSuper(parent)); }
var E = heirOf(Error), T = heirOf(TypeError), Below = function (_E) { function B(m) { var _this2; _classCallCheck(this, B); _this2 = _callSuper(this, B, arguments); _this2.name = "Below"; return _this2; } _inherits(B, _E); return B; }(E);
function make(C, m, o) { return new C(m, o); }
for (const C of [E, T, Below]) {
  const e = make(C, "m", { cause: 7 });
  console.log(C === T || shown(e), e instanceof C, e instanceof Error, e instanceof TypeError, e.describe(), e.cause, Object.keys(e).join(), Object.prototype.toString.call(e), e.constructor === C, String(e));
}
try { E("no"); } catch (e) { console.log(e.message); }
try { make(E, Symbol("s")); } catch (e) { console.log(e.message); }
try { throw make(Below, "thrown"); } catch (e) { console.log(shown(e)); }
function three(a, b, c) { return Reflect.construct.apply(null, arguments); }
function four(a, b, c, d) { return Reflect.construct.apply(null, arguments); }
function changed(a, b, c) { c = Error; return Reflect.construct.apply(null, arguments); }
function stored(a, b, c) { arguments[1] = ["stored"]; return Reflect.construct.apply(null, arguments); }
function strict(a, b, c) { "use strict"; return Reflect.construct.apply(null, arguments); }
function Plain(x) { this.x = x; this.target = new.target === E; }
for (const f of [three, four, changed, stored, strict]) for (const list of [[Error, ["e"], E], [Error, ["e"]], [Error, ["e"], void 0], [Error, ["e"], null], [Error, "text", E], [Error], [], [Plain, [3], E], [Plain, [4]], [Error, ["e"], E, 1, 2], [class K extends Error {}, ["k"], E], [Map, [[[1, 2]]], E]])
  try { const made = f(...list); console.log(made.message, made.x, made.target, made instanceof E, made.size); } catch (e) { console.log(e.name + ": " + e.message); }
let t = 0;
for (let i = 0; i < 300; i++) { const e = make(i & 1 ? E : Below, "m" + (i & 3)); t += e.message.length + e.code; }
console.log(t);
