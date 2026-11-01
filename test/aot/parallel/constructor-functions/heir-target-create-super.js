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
function _createSuper(Derived) { var hasNativeReflectConstruct = _isNativeReflectConstruct(); return function _createSuperInternal() { var Super = _getPrototypeOf(Derived), result; if (hasNativeReflectConstruct) { var NewTarget = _getPrototypeOf(this).constructor; result = Reflect.construct(Super, arguments, NewTarget); } else { result = Super.apply(this, arguments); } return _possibleConstructorReturn(this, result); }; }
var Meter = function Meter(size) { this.size = size; this.n = 0; };
var Sub = (function (_Meter) { _inherits(Sub, _Meter); var _super = _createSuper(Sub); function Sub(size) { var _this; _this = _super.call(this, size); _this.extra = "x"; return _this; } return Sub; })(Meter);
var s = new Sub(2), o = Reflect.construct(Meter, [9], Sub); console.log(see(s), "|", see(o), o instanceof Sub);
