// Alone: what is claimed of the heir's fields is a fact about the whole program: another maker of its objects takes the claim away.
// Reflect.construct(above, list, heir) runs the function above alone: the heir's own fields were never stored.
const see = o => [String(o.size), String(o.extra), "extra" in o, Object.keys(o).join(), typeof o.extra].join(" ");
function _callSuper(t, o, e) { return (o = _getPrototypeOf(o)), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function _possibleConstructorReturn(t, e) { if (e && ("object" == typeof e || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); return _assertThisInitialized(t); }
function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); return e; }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} return (_isNativeReflectConstruct = function () { return !!t; })(); }
function _getPrototypeOf(t) { return (_getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) { return t.__proto__ || Object.getPrototypeOf(t); }), _getPrototypeOf(t); }
function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); (t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } })), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }
function _setPrototypeOf(t, e) { return (_setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return (t.__proto__ = e), t; }), _setPrototypeOf(t, e); }
var Meter = function Meter(size) { this.size = size; this.n = 0; };
var Sub = (function (_Meter) { function Sub(size) { var _this; _this = _callSuper(this, Sub, [size]); _this.extra = "x"; return _this; } _inherits(Sub, _Meter); return Sub; })(Meter);
var Leaf = (function (_Sub) { function Leaf(size) { var _this2; _this2 = _callSuper(this, Leaf, [size]); _this2.leaf = 1; return _this2; } _inherits(Leaf, _Sub); return Leaf; })(Sub);
var s = new Sub(2), l = new Leaf(3), o = Reflect.construct(Meter, [9], Sub), q = Reflect.construct(Sub, [8], Leaf), r = Reflect.construct(Meter, [7], Leaf);
console.log(see(s), "|", see(l), String(l.leaf), "|", see(o), "|", see(q), String(q.leaf), "leaf" in q, "|", see(r), String(r.leaf), "leaf" in r);
