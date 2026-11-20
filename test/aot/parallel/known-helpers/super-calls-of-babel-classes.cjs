// Classes that Babel turned into functions: what is filled, returned, thrown and seen, whatever the parent is, however the class is constructed, and where its prototype, its constructor or its parent has changed.
"use strict";
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function _possibleConstructorReturn(t, e) { if (e && ("object" == _typeof(e) || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); return _assertThisInitialized(t); }
function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); return e; }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} return (_isNativeReflectConstruct = function _isNativeReflectConstruct() { return !!t; })(); }
function _getPrototypeOf(t) { return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) { return t.__proto__ || Object.getPrototypeOf(t); }, _getPrototypeOf(t); }
function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }
function _setPrototypeOf(t, e) { return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, _setPrototypeOf(t, e); }

var log = [], seen = [], step = 0, changing = null;
function change(v) { if (changing) changing(); return v; }
function tell(v) { return v && typeof v === "object" || typeof v === "function" ? typeof v + "{" + Reflect.ownKeys(v).filter(function (q) { return typeof v !== "function" && !["stack", "line", "column", "originalLine", "originalColumn", "sourceURL"].includes(q); }).map(function (q) { var d = Object.getOwnPropertyDescriptor(v, q); return String(q) + ":" + (d.get ? "get" : typeof d.value === "object" && d.value ? "object" : typeof d.value === "function" ? "function" : String(d.value)) + +d.writable + +d.enumerable + +d.configurable; }).join() + "}" + chain(v) : typeof v + String(v); }
function chain(v) { var s = ""; for (var p = Object.getPrototypeOf(v), i = 0; p && i < 5; p = Object.getPrototypeOf(p), i++) { var d = Object.getOwnPropertyDescriptor(p, "constructor"); s += ">" + (d && d.value ? d.value.name : "none"); } return s; }
function note(f) { try { log.push(tell(f())); } catch (e) { log.push(e.constructor.name + ": " + e.message); } }
var parents = [
  function () {
  var Animal = function () { function Animal(a, b) { _classCallCheck(this, Animal); this.a = a; this.b = b; } return _createClass(Animal, [{ key: "age", value: function age() { return this.a; } }]); }();
  var Dog = /*#__PURE__*/function (_A) { function Dog(a, b) { var _this; _classCallCheck(this, Dog); _this = _callSuper(this, Dog, [change(a), b]); _this.weight = b; _this.legs = 4; _defineProperty(_this, "owner", null); return _this; } _inherits(Dog, _A); return _createClass(Dog, [{ key: "sum", value: function sum() { return this.a + this.weight + this.legs; } }]); }(Animal);
  var Cat = /*#__PURE__*/function (_A) { function Cat(a, b) { _classCallCheck(this, Cat); return _callSuper(this, Cat, arguments); } _inherits(Cat, _A); return _createClass(Cat, [{ key: "age", value: function age() { return "cat" + this.a; } }]); }(Animal);
  var Puppy = /*#__PURE__*/function (_A) { function Puppy(a, b) { var _this; _classCallCheck(this, Puppy); _this = _callSuper(this, Puppy, [a, step++]); _this.puppy = a; _this.run = function () { return _this.weight; }; return _this; } _inherits(Puppy, _A); return _createClass(Puppy, [{ key: "sum", value: function sum() { return this.run() + this.puppy; } }]); }(Dog);
  var Mixed = /*#__PURE__*/function (_A) { function Mixed(a, b) { var _this; _classCallCheck(this, Mixed); _this = _callSuper(this, Mixed); if (a === 2) return _possibleConstructorReturn(_this, { instead: a }); if (a === 3) return _possibleConstructorReturn(_this); delete _this.a; return _this; } _inherits(Mixed, _A); return _createClass(Mixed, []); }(Animal);
  var Plain = /*#__PURE__*/function (_A) { function Plain(a, b) { var _this; _this = _callSuper(this, Plain, [a]); seen.push(_this); if (a === 1) return; return _this; } _inherits(Plain, _A); return _createClass(Plain, []); }(Animal);
  return [Dog, Cat, Puppy, Mixed, Plain];
  },
  function () {
  var Animal = function Animal(a) { this.a = a; if (a === 1) return { instead: a }; if (a === 2) return 7; };
  var Dog = /*#__PURE__*/function (_A) { function Dog(a, b) { var _this; _classCallCheck(this, Dog); _this = _callSuper(this, Dog, [change(a), b]); _this.weight = b; _this.legs = 4; _defineProperty(_this, "owner", null); return _this; } _inherits(Dog, _A); return _createClass(Dog, [{ key: "sum", value: function sum() { return this.a + this.weight + this.legs; } }]); }(Animal);
  var Cat = /*#__PURE__*/function (_A) { function Cat(a, b) { _classCallCheck(this, Cat); return _callSuper(this, Cat, arguments); } _inherits(Cat, _A); return _createClass(Cat, [{ key: "age", value: function age() { return "cat" + this.a; } }]); }(Animal);
  var Puppy = /*#__PURE__*/function (_A) { function Puppy(a, b) { var _this; _classCallCheck(this, Puppy); _this = _callSuper(this, Puppy, [a, step++]); _this.puppy = a; _this.run = function () { return _this.weight; }; return _this; } _inherits(Puppy, _A); return _createClass(Puppy, [{ key: "sum", value: function sum() { return this.run() + this.puppy; } }]); }(Dog);
  var Mixed = /*#__PURE__*/function (_A) { function Mixed(a, b) { var _this; _classCallCheck(this, Mixed); _this = _callSuper(this, Mixed); if (a === 2) return _possibleConstructorReturn(_this, { instead: a }); if (a === 3) return _possibleConstructorReturn(_this); delete _this.a; return _this; } _inherits(Mixed, _A); return _createClass(Mixed, []); }(Animal);
  var Plain = /*#__PURE__*/function (_A) { function Plain(a, b) { var _this; _this = _callSuper(this, Plain, [a]); seen.push(_this); if (a === 1) return; return _this; } _inherits(Plain, _A); return _createClass(Plain, []); }(Animal);
  return [Dog, Cat, Puppy, Mixed, Plain];
  },
  function () {
  var Animal = function Animal(a) { this.target = new.target && new.target.name; this.a = a; };
  var Dog = /*#__PURE__*/function (_A) { function Dog(a, b) { var _this; _classCallCheck(this, Dog); _this = _callSuper(this, Dog, [change(a), b]); _this.weight = b; _this.legs = 4; _defineProperty(_this, "owner", null); return _this; } _inherits(Dog, _A); return _createClass(Dog, [{ key: "sum", value: function sum() { return this.a + this.weight + this.legs; } }]); }(Animal);
  var Cat = /*#__PURE__*/function (_A) { function Cat(a, b) { _classCallCheck(this, Cat); return _callSuper(this, Cat, arguments); } _inherits(Cat, _A); return _createClass(Cat, [{ key: "age", value: function age() { return "cat" + this.a; } }]); }(Animal);
  var Puppy = /*#__PURE__*/function (_A) { function Puppy(a, b) { var _this; _classCallCheck(this, Puppy); _this = _callSuper(this, Puppy, [a, step++]); _this.puppy = a; _this.run = function () { return _this.weight; }; return _this; } _inherits(Puppy, _A); return _createClass(Puppy, [{ key: "sum", value: function sum() { return this.run() + this.puppy; } }]); }(Dog);
  var Mixed = /*#__PURE__*/function (_A) { function Mixed(a, b) { var _this; _classCallCheck(this, Mixed); _this = _callSuper(this, Mixed); if (a === 2) return _possibleConstructorReturn(_this, { instead: a }); if (a === 3) return _possibleConstructorReturn(_this); delete _this.a; return _this; } _inherits(Mixed, _A); return _createClass(Mixed, []); }(Animal);
  var Plain = /*#__PURE__*/function (_A) { function Plain(a, b) { var _this; _this = _callSuper(this, Plain, [a]); seen.push(_this); if (a === 1) return; return _this; } _inherits(Plain, _A); return _createClass(Plain, []); }(Animal);
  return [Dog, Cat, Puppy, Mixed, Plain];
  },
  function () {
  var Animal = function Animal(a) { seen.push(this); this.own = this.constructor && this.constructor.name; if (a === 3) throw new RangeError("three"); };
  var Dog = /*#__PURE__*/function (_A) { function Dog(a, b) { var _this; _classCallCheck(this, Dog); _this = _callSuper(this, Dog, [change(a), b]); _this.weight = b; _this.legs = 4; _defineProperty(_this, "owner", null); return _this; } _inherits(Dog, _A); return _createClass(Dog, [{ key: "sum", value: function sum() { return this.a + this.weight + this.legs; } }]); }(Animal);
  var Cat = /*#__PURE__*/function (_A) { function Cat(a, b) { _classCallCheck(this, Cat); return _callSuper(this, Cat, arguments); } _inherits(Cat, _A); return _createClass(Cat, [{ key: "age", value: function age() { return "cat" + this.a; } }]); }(Animal);
  var Puppy = /*#__PURE__*/function (_A) { function Puppy(a, b) { var _this; _classCallCheck(this, Puppy); _this = _callSuper(this, Puppy, [a, step++]); _this.puppy = a; _this.run = function () { return _this.weight; }; return _this; } _inherits(Puppy, _A); return _createClass(Puppy, [{ key: "sum", value: function sum() { return this.run() + this.puppy; } }]); }(Dog);
  var Mixed = /*#__PURE__*/function (_A) { function Mixed(a, b) { var _this; _classCallCheck(this, Mixed); _this = _callSuper(this, Mixed); if (a === 2) return _possibleConstructorReturn(_this, { instead: a }); if (a === 3) return _possibleConstructorReturn(_this); delete _this.a; return _this; } _inherits(Mixed, _A); return _createClass(Mixed, []); }(Animal);
  var Plain = /*#__PURE__*/function (_A) { function Plain(a, b) { var _this; _this = _callSuper(this, Plain, [a]); seen.push(_this); if (a === 1) return; return _this; } _inherits(Plain, _A); return _createClass(Plain, []); }(Animal);
  return [Dog, Cat, Puppy, Mixed, Plain];
  },
  function () {
  var Animal = class Animal { constructor(a) { this.a = a; } };
  var Dog = /*#__PURE__*/function (_A) { function Dog(a, b) { var _this; _classCallCheck(this, Dog); _this = _callSuper(this, Dog, [change(a), b]); _this.weight = b; _this.legs = 4; _defineProperty(_this, "owner", null); return _this; } _inherits(Dog, _A); return _createClass(Dog, [{ key: "sum", value: function sum() { return this.a + this.weight + this.legs; } }]); }(Animal);
  var Cat = /*#__PURE__*/function (_A) { function Cat(a, b) { _classCallCheck(this, Cat); return _callSuper(this, Cat, arguments); } _inherits(Cat, _A); return _createClass(Cat, [{ key: "age", value: function age() { return "cat" + this.a; } }]); }(Animal);
  var Puppy = /*#__PURE__*/function (_A) { function Puppy(a, b) { var _this; _classCallCheck(this, Puppy); _this = _callSuper(this, Puppy, [a, step++]); _this.puppy = a; _this.run = function () { return _this.weight; }; return _this; } _inherits(Puppy, _A); return _createClass(Puppy, [{ key: "sum", value: function sum() { return this.run() + this.puppy; } }]); }(Dog);
  var Mixed = /*#__PURE__*/function (_A) { function Mixed(a, b) { var _this; _classCallCheck(this, Mixed); _this = _callSuper(this, Mixed); if (a === 2) return _possibleConstructorReturn(_this, { instead: a }); if (a === 3) return _possibleConstructorReturn(_this); delete _this.a; return _this; } _inherits(Mixed, _A); return _createClass(Mixed, []); }(Animal);
  var Plain = /*#__PURE__*/function (_A) { function Plain(a, b) { var _this; _this = _callSuper(this, Plain, [a]); seen.push(_this); if (a === 1) return; return _this; } _inherits(Plain, _A); return _createClass(Plain, []); }(Animal);
  return [Dog, Cat, Puppy, Mixed, Plain];
  },
  function () {
  var Animal = Error;
  var Dog = /*#__PURE__*/function (_A) { function Dog(a, b) { var _this; _classCallCheck(this, Dog); _this = _callSuper(this, Dog, [change(a), b]); _this.weight = b; _this.legs = 4; _defineProperty(_this, "owner", null); return _this; } _inherits(Dog, _A); return _createClass(Dog, [{ key: "sum", value: function sum() { return this.a + this.weight + this.legs; } }]); }(Animal);
  var Cat = /*#__PURE__*/function (_A) { function Cat(a, b) { _classCallCheck(this, Cat); return _callSuper(this, Cat, arguments); } _inherits(Cat, _A); return _createClass(Cat, [{ key: "age", value: function age() { return "cat" + this.a; } }]); }(Animal);
  var Puppy = /*#__PURE__*/function (_A) { function Puppy(a, b) { var _this; _classCallCheck(this, Puppy); _this = _callSuper(this, Puppy, [a, step++]); _this.puppy = a; _this.run = function () { return _this.weight; }; return _this; } _inherits(Puppy, _A); return _createClass(Puppy, [{ key: "sum", value: function sum() { return this.run() + this.puppy; } }]); }(Dog);
  var Mixed = /*#__PURE__*/function (_A) { function Mixed(a, b) { var _this; _classCallCheck(this, Mixed); _this = _callSuper(this, Mixed); if (a === 2) return _possibleConstructorReturn(_this, { instead: a }); if (a === 3) return _possibleConstructorReturn(_this); delete _this.a; return _this; } _inherits(Mixed, _A); return _createClass(Mixed, []); }(Animal);
  var Plain = /*#__PURE__*/function (_A) { function Plain(a, b) { var _this; _this = _callSuper(this, Plain, [a]); seen.push(_this); if (a === 1) return; return _this; } _inherits(Plain, _A); return _createClass(Plain, []); }(Animal);
  return [Dog, Cat, Puppy, Mixed, Plain];
  },
  function () {
  var Animal = Map;
  var Dog = /*#__PURE__*/function (_A) { function Dog(a, b) { var _this; _classCallCheck(this, Dog); _this = _callSuper(this, Dog, [change(a), b]); _this.weight = b; _this.legs = 4; _defineProperty(_this, "owner", null); return _this; } _inherits(Dog, _A); return _createClass(Dog, [{ key: "sum", value: function sum() { return this.a + this.weight + this.legs; } }]); }(Animal);
  var Cat = /*#__PURE__*/function (_A) { function Cat(a, b) { _classCallCheck(this, Cat); return _callSuper(this, Cat, arguments); } _inherits(Cat, _A); return _createClass(Cat, [{ key: "age", value: function age() { return "cat" + this.a; } }]); }(Animal);
  var Puppy = /*#__PURE__*/function (_A) { function Puppy(a, b) { var _this; _classCallCheck(this, Puppy); _this = _callSuper(this, Puppy, [a, step++]); _this.puppy = a; _this.run = function () { return _this.weight; }; return _this; } _inherits(Puppy, _A); return _createClass(Puppy, [{ key: "sum", value: function sum() { return this.run() + this.puppy; } }]); }(Dog);
  var Mixed = /*#__PURE__*/function (_A) { function Mixed(a, b) { var _this; _classCallCheck(this, Mixed); _this = _callSuper(this, Mixed); if (a === 2) return _possibleConstructorReturn(_this, { instead: a }); if (a === 3) return _possibleConstructorReturn(_this); delete _this.a; return _this; } _inherits(Mixed, _A); return _createClass(Mixed, []); }(Animal);
  var Plain = /*#__PURE__*/function (_A) { function Plain(a, b) { var _this; _this = _callSuper(this, Plain, [a]); seen.push(_this); if (a === 1) return; return _this; } _inherits(Plain, _A); return _createClass(Plain, []); }(Animal);
  return [Dog, Cat, Puppy, Mixed, Plain];
  },
  function () {
  var Animal = Array;
  var Dog = /*#__PURE__*/function (_A) { function Dog(a, b) { var _this; _classCallCheck(this, Dog); _this = _callSuper(this, Dog, [change(a), b]); _this.weight = b; _this.legs = 4; _defineProperty(_this, "owner", null); return _this; } _inherits(Dog, _A); return _createClass(Dog, [{ key: "sum", value: function sum() { return this.a + this.weight + this.legs; } }]); }(Animal);
  var Cat = /*#__PURE__*/function (_A) { function Cat(a, b) { _classCallCheck(this, Cat); return _callSuper(this, Cat, arguments); } _inherits(Cat, _A); return _createClass(Cat, [{ key: "age", value: function age() { return "cat" + this.a; } }]); }(Animal);
  var Puppy = /*#__PURE__*/function (_A) { function Puppy(a, b) { var _this; _classCallCheck(this, Puppy); _this = _callSuper(this, Puppy, [a, step++]); _this.puppy = a; _this.run = function () { return _this.weight; }; return _this; } _inherits(Puppy, _A); return _createClass(Puppy, [{ key: "sum", value: function sum() { return this.run() + this.puppy; } }]); }(Dog);
  var Mixed = /*#__PURE__*/function (_A) { function Mixed(a, b) { var _this; _classCallCheck(this, Mixed); _this = _callSuper(this, Mixed); if (a === 2) return _possibleConstructorReturn(_this, { instead: a }); if (a === 3) return _possibleConstructorReturn(_this); delete _this.a; return _this; } _inherits(Mixed, _A); return _createClass(Mixed, []); }(Animal);
  var Plain = /*#__PURE__*/function (_A) { function Plain(a, b) { var _this; _this = _callSuper(this, Plain, [a]); seen.push(_this); if (a === 1) return; return _this; } _inherits(Plain, _A); return _createClass(Plain, []); }(Animal);
  return [Dog, Cat, Puppy, Mixed, Plain];
  }
];
function inLoop(C) { var s = ""; for (var i = 0; i < 5; i++) { try { var o = new C(i, "b"); s += typeof o.a + typeof o.weight + (o.sum ? o.sum() : "") + (o.age ? o.age() : "") + (o instanceof C); } catch (e) { s += e.constructor.name; } } return s; }
parents.forEach(function (parent, kind) {
  parent().forEach(function (C, number) {
    for (var i = 0; i < 5; i++) (function (i) { note(function () { return new C(i, "n"); }); })(i);
    note(function () { return inLoop(C); }); note(function () { return C.call({ own: 1 }, 2); }); note(function () { return C(1); });
    note(function () { var o = Object.create(C.prototype), p = C.call(o, 7); return [tell(o), tell(p), o === p].join(); });
    note(function () { return Reflect.construct(C, [1, 2], function Nt() {}); }); note(function () { return Reflect.construct(C, [4], Object); });
    note(function () { class E extends C { constructor(a) { super(a, "e"); this.e = 1; } } var o = new E(4); return [tell(o), o instanceof E].join(); });
    note(function () { return new (C.bind(null, 4))(5); }); note(function () { return new (new Proxy(C, {}))(4); });
    note(function () { function Es5(a) { var t = C.call(this, a) || this; t.es5 = 1; return t; } Es5.prototype = Object.create(C.prototype); return new Es5(4); });
    if (kind < 4 && number < 2) {
      var asked = 0, once = function (o) { seen.push(o); delete C[Symbol.hasInstance]; return true; };
      note(function () { Object.defineProperty(C, Symbol.hasInstance, { configurable: true, value: function (o) { seen.push(o); return true; } }); var o = new C(4, "own"); delete C[Symbol.hasInstance]; return o; });
      note(function () { Object.defineProperty(C, Symbol.hasInstance, { configurable: true, value: once }); return new C(4, "once"); });
      note(function () { Object.defineProperty(C, Symbol.hasInstance, { configurable: true, get: function () { asked++; return Function.prototype[Symbol.hasInstance]; } }); var o = new C(4, "get"); delete C[Symbol.hasInstance]; return [tell(o), asked].join(); });
      note(function () { var above = Object.getPrototypeOf(C); Object.defineProperty(above, Symbol.hasInstance, { configurable: true, value: function (o) { seen.push(o); return true; } }); var o = new C(4, "above"); delete above[Symbol.hasInstance]; return o; });
      note(function () { var above = Object.getPrototypeOf(C), told = []; Object.setPrototypeOf(above, new Proxy(Function.prototype, { get: function (t, q, w) { told.push(String(q)); return Reflect.get(t, q, w); } })); var o = new C(4, "chain"); Object.setPrototypeOf(above, Function.prototype); return [tell(o), told].join(); });
      note(function () { var told = [], P = new Proxy(C, { get: function (t, q, w) { told.push(String(q)); return Reflect.get(t, q, w); } }); C.prototype.constructor = P; var o = new P(4, "proxy"); C.prototype.constructor = C; return [tell(o), told].join(); });
      note(function () { function Nt() {} var first = Nt.prototype; changing = function () { Nt.prototype = { constructor: Nt, second: 1 }; }; var o = Reflect.construct(C, [4, "late"], Nt); changing = null; return [tell(o), Object.getPrototypeOf(o) === first, Object.getPrototypeOf(o).second].join(); });
    }
    if (number === 0) {
      note(function () { C.prototype.constructor = Object; return new C(4); }); note(function () { delete C.prototype.constructor; return new C(4); });
      note(function () { Object.defineProperty(C.prototype, "constructor", { configurable: true, get: function () { log.push("got"); return C; } }); return new C(4); });
      note(function () { Object.setPrototypeOf(C, function Late(a) { this.late = a; }); return new C(4); });
      note(function () { Object.defineProperty(C, Symbol.hasInstance, { value: function (o) { seen.push(o); return true; } }); return new C(4); });
    }
  });
});
seen.forEach(function (o) { note(function () { return o; }); });
console.log(log.join("\n"));
