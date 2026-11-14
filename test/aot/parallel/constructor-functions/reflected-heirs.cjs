// Babel's heirs in a mixin: Reflect.construct() makes their objects, as objects of the heir's class.
// COUNTER: operationAOTFillSiteAnswers <= 20
"use strict";
function Cursor(text) { this.text = text; this.pos = 0; this.type = "eof"; this.start = 0; this.end = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.end = this.pos; this.pos++; this.type = "name"; this.value = this.end - this.start; return this.value; };
Cursor.prototype.all = function () { var n = 0; while (this.pos < this.text.length) n += this.step(); return n; };
function mixin(Base) {
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function _possibleConstructorReturn(t, e) { if (e && ("object" == _typeof(e) || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); return _assertThisInitialized(t); }
function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); return e; }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} return (_isNativeReflectConstruct = function _isNativeReflectConstruct() { return !!t; })(); }
function _getPrototypeOf(t) { return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) { return t.__proto__ || Object.getPrototypeOf(t); }, _getPrototypeOf(t); }
function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }
function _setPrototypeOf(t, e) { return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, _setPrototypeOf(t, e); }
var Heir = /*#__PURE__*/function (_Cursor) { function Heir(text) { var _this; _classCallCheck(this, Heir); _this = _callSuper(this, Heir, [text]); _this.extra = 1; return _this; } _inherits(Heir, _Cursor); return _createClass(Heir, [{ key: "more", value: function more() { return this.extra + this.pos; } }]); }(Base);
return Heir;
}
var Heir = mixin(Cursor);
const out = [], text = "alpha beta gamma delta ".repeat(4);
let total = 0;
for (let i = 0; i < 200; i++) { const h = new Heir(text); total += h.all() + h.more(); }
const h = new Heir("a bc");
out.push(total, JSON.stringify(h), h.all(), h.more(), Object.keys(h).join(), h instanceof Cursor, h instanceof Heir, h.constructor === Heir, Object.getPrototypeOf(h) === Heir.prototype);
h.text = 1; h.pos = "p"; delete h.type; h.late = [1]; h.value = { a: 1 };
const keys = []; for (const key in h) keys.push(key);
out.push(keys.join(), JSON.stringify(h), "type" in h, h.more());
function Plain(a) { this.a = a; } Plain.prototype = Object.create(Heir.prototype); Plain.prototype.constructor = Plain;
const p = Reflect.construct(Cursor, ["q r"], Plain); out.push(JSON.stringify(p), p instanceof Plain, p instanceof Heir, p.all(), Object.keys(p).join());
const o = Reflect.construct(Cursor, ["r"], Object); out.push(JSON.stringify(o), Object.getPrototypeOf(o) === Object.prototype);
const e = Reflect.construct(Cursor, ["s t"], Heir); out.push(JSON.stringify(e), e instanceof Heir, e.all(), e.more());
class Below extends Heir { own = 1; all() { return super.all() + this.own; } } const b = new Below("u v w"); out.push(JSON.stringify(b), b.all(), b instanceof Cursor);
Heir.prototype.all = function () { return -1; }; out.push(new Heir("t").all(), h.all(), e.all(), b.all());
Object.setPrototypeOf(Object.getPrototypeOf(h), { kind() { return "other"; } }); const last = new Heir("u"); out.push(JSON.stringify(last), last instanceof Cursor, Reflect.construct(Cursor, ["v"], Heir).text);
const same = h.constructor; Object.setPrototypeOf(same || Heir, Array); let name = ""; try { const a = new Heir(3); name = Array.isArray(a) + String(a.length); } catch (error) { name = error.constructor.name; } out.push(name);
for (const line of out) console.log(String(line));
