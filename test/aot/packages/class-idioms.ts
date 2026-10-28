// How JavaScript packages make and change classes: ES5 inheritance in all its forms, the helpers that TypeScript and Babel emit (copied as the compilers write them into every package), mixins, methods added or replaced later, what constructors do.
import { inBothModes, js, pkg, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  ...inBothModes("inherits-emitter", "id_inherits_emitter", {
    "index.js": `var EventEmitter = require("node:events");
var util = require("node:util");
function Sub(n) { EventEmitter.call(this); this.n = n; }
util.inherits(Sub, EventEmitter);
Sub.prototype.go = function () { return this.emit("go", this.n); };
var s = new Sub(5); var got = [];
s.on("go", function (n) { got.push(n, this === s); });
exports.ok = [s.go(), got, s instanceof EventEmitter, Sub.super_ === EventEmitter, Object.keys(s).sort()];
`,
  }),
  ...inBothModes("object-create", "id_object_create", {
    "index.js": `function Base(a) { this.a = a; }
Base.prototype.who = function () { return "Base" + this.a; };
Base.stat = "s";
function Sub(a, b) { Base.call(this, a); this.b = b; }
Sub.prototype = Object.create(Base.prototype);
Sub.prototype.constructor = Sub;
Sub.prototype.who = function () { return "Sub<" + Base.prototype.who.call(this) + this.b; };
var s = new Sub(1, 2);
exports.ok = [s.who(), s instanceof Base, s.constructor.name, Object.keys(s), Sub.stat, Object.getPrototypeOf(Sub.prototype) === Base.prototype];
`,
  }),
  ...inBothModes("proto-assign", "id_proto_assign", {
    "index.js": `function Base() {}
Base.prototype.m = function () { return "m"; };
function Sub() {}
Sub.prototype.__proto__ = Base.prototype;
Sub.__proto__ = Base;
Base.s = function () { return "s"; };
exports.ok = [new Sub().m(), Sub.s(), new Sub() instanceof Base];
`,
  }),
  ...inBothModes("set-prototype-of", "id_set_prototype_of", {
    "index.js": `function Base() {}
Base.prototype.m = function () { return "m"; };
function Sub() {}
Object.setPrototypeOf(Sub.prototype, Base.prototype);
Object.setPrototypeOf(Sub, Base);
exports.ok = [new Sub().m(), new Sub() instanceof Base, Object.getPrototypeOf(Sub) === Base];
`,
  }),
  ...inBothModes("new-base-as-prototype", "id_new_base_as_prototype", {
    "index.js": `function Base() { this.list = []; }
Base.prototype.add = function (x) { this.list.push(x); return this.list.length; };
function Sub() {}
Sub.prototype = new Base();
var a = new Sub(), b = new Sub();
exports.ok = [a.add(1), b.add(2), a.list === b.list, a.constructor.name];
`,
  }),
  ...inBothModes("typescript-extends-function", "id_ts_extends_function", {
    "index.js": `var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var Base = /** @class */ (function () {
    function Base(a) { this.a = a; }
    Base.prototype.who = function () { return "Base" + this.a; };
    Base.make = function () { return new this(9); };
    return Base;
}());
var Sub = /** @class */ (function (_super) {
    __extends(Sub, _super);
    function Sub(a) { var _this = _super.call(this, a) || this; _this.b = 2; return _this; }
    Sub.prototype.who = function () { return "Sub<" + _super.prototype.who.call(this); };
    return Sub;
}(Base));
var s = new Sub(1);
exports.ok = [s.who(), s instanceof Base, Sub.make().who(), Object.keys(s), s.constructor === Sub];
`,
  }),
  ...inBothModes("typescript-extends-error", "id_ts_extends_error", {
    "index.js": `var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var MyError = /** @class */ (function (_super) {
    __extends(MyError, _super);
    function MyError(m) { var _this = _super.call(this, m) || this; Object.setPrototypeOf(_this, MyError.prototype); _this.name = "MyError"; _this.code = 7; return _this; }
    MyError.prototype.describe = function () { return this.name + ":" + this.message + ":" + this.code; };
    return MyError;
}(Error));
var e = new MyError("m");
exports.ok = [e.describe(), e instanceof MyError, e instanceof Error, typeof e.stack, String(e), Object.prototype.toString.call(e)];
`,
  }),
  ...inBothModes("typescript-extends-array", "id_ts_extends_array", {
    "index.js": `var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var List = /** @class */ (function (_super) {
    __extends(List, _super);
    function List() { var _this = _super !== null && _super.apply(this, arguments) || this; Object.setPrototypeOf(_this, List.prototype); return _this; }
    List.prototype.last = function () { return this[this.length - 1]; };
    return List;
}(Array));
var l = new List(); l.push(1, 2);
exports.ok = [l.length, l.last(), l instanceof Array, Array.isArray(l), JSON.stringify(l)];
`,
  }),
  ...inBothModes("babel-class", "id_babel_class", {
    "index.js": `function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }
function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} return (_isNativeReflectConstruct = function () { return !!t; })(); }
function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); return e; }
function _possibleConstructorReturn(t, e) { if (e && ("object" == typeof e || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); return _assertThisInitialized(t); }
function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _isNativeFunction(t) { try { return -1 !== Function.toString.call(t).indexOf("[native code]"); } catch (n) { return "function" == typeof t; } }
function _construct(t, e, r) { if (_isNativeReflectConstruct()) return Reflect.construct.apply(null, arguments); var o = [null]; o.push.apply(o, e); var p = new (t.bind.apply(t, o))(); return r && _setPrototypeOf(p, r.prototype), p; }
function _wrapNativeSuper(t) { var r = "function" == typeof Map ? new Map() : void 0; return _wrapNativeSuper = function (t) { if (null === t || !_isNativeFunction(t)) return t; if ("function" != typeof t) throw new TypeError("Super expression must either be null or a function"); if (void 0 !== r) { if (r.has(t)) return r.get(t); r.set(t, Wrapper); } function Wrapper() { return _construct(t, arguments, _getPrototypeOf(this).constructor); } return Wrapper.prototype = Object.create(t.prototype, { constructor: { value: Wrapper, enumerable: !1, writable: !0, configurable: !0 } }), _setPrototypeOf(Wrapper, t); }, _wrapNativeSuper(t); }
var Base = function Base(a) { _classCallCheck(this, Base); this.a = a; };
Base.prototype.who = function () { return "Base" + this.a; };
var Sub = function (_Base) { function Sub(a) { var _this; _classCallCheck(this, Sub); _this = _callSuper(this, Sub, [a]); _this.b = 2; return _this; } _inherits(Sub, _Base); return Sub; }(Base);
var s = new Sub(1);
var called; try { Sub(1); called = "no throw"; } catch (e) { called = e.message; }
exports.ok = [s.who(), s.b, s instanceof Base, called, Object.keys(s)];
`,
  }),
  ...inBothModes("babel-native-error", "id_babel_native_error", {
    "index.js": `function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }
function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} return (_isNativeReflectConstruct = function () { return !!t; })(); }
function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); return e; }
function _possibleConstructorReturn(t, e) { if (e && ("object" == typeof e || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); return _assertThisInitialized(t); }
function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _isNativeFunction(t) { try { return -1 !== Function.toString.call(t).indexOf("[native code]"); } catch (n) { return "function" == typeof t; } }
function _construct(t, e, r) { if (_isNativeReflectConstruct()) return Reflect.construct.apply(null, arguments); var o = [null]; o.push.apply(o, e); var p = new (t.bind.apply(t, o))(); return r && _setPrototypeOf(p, r.prototype), p; }
function _wrapNativeSuper(t) { var r = "function" == typeof Map ? new Map() : void 0; return _wrapNativeSuper = function (t) { if (null === t || !_isNativeFunction(t)) return t; if ("function" != typeof t) throw new TypeError("Super expression must either be null or a function"); if (void 0 !== r) { if (r.has(t)) return r.get(t); r.set(t, Wrapper); } function Wrapper() { return _construct(t, arguments, _getPrototypeOf(this).constructor); } return Wrapper.prototype = Object.create(t.prototype, { constructor: { value: Wrapper, enumerable: !1, writable: !0, configurable: !0 } }), _setPrototypeOf(Wrapper, t); }, _wrapNativeSuper(t); }
var MyError = function (_Error) { function MyError(m) { var _this; _classCallCheck(this, MyError); _this = _callSuper(this, MyError, [m]); _this.name = "MyError"; return _this; } _inherits(MyError, _Error); return MyError; }(_wrapNativeSuper(Error));
var e = new MyError("m");
exports.ok = [e.message, e.name, e instanceof MyError, e instanceof Error, typeof e.stack, String(e)];
`,
  }),
  ...inBothModes("babel-native-map", "id_babel_native_map", {
    "index.js": `function _setPrototypeOf(o, p) { _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (o, p) { o.__proto__ = p; return o; }; return _setPrototypeOf(o, p); }
function _getPrototypeOf(o) { _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (o) { return o.__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} return (_isNativeReflectConstruct = function () { return !!t; })(); }
function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); return e; }
function _possibleConstructorReturn(t, e) { if (e && ("object" == typeof e || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); return _assertThisInitialized(t); }
function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _isNativeFunction(t) { try { return -1 !== Function.toString.call(t).indexOf("[native code]"); } catch (n) { return "function" == typeof t; } }
function _construct(t, e, r) { if (_isNativeReflectConstruct()) return Reflect.construct.apply(null, arguments); var o = [null]; o.push.apply(o, e); var p = new (t.bind.apply(t, o))(); return r && _setPrototypeOf(p, r.prototype), p; }
function _wrapNativeSuper(t) { var r = "function" == typeof Map ? new Map() : void 0; return _wrapNativeSuper = function (t) { if (null === t || !_isNativeFunction(t)) return t; if ("function" != typeof t) throw new TypeError("Super expression must either be null or a function"); if (void 0 !== r) { if (r.has(t)) return r.get(t); r.set(t, Wrapper); } function Wrapper() { return _construct(t, arguments, _getPrototypeOf(this).constructor); } return Wrapper.prototype = Object.create(t.prototype, { constructor: { value: Wrapper, enumerable: !1, writable: !0, configurable: !0 } }), _setPrototypeOf(Wrapper, t); }, _wrapNativeSuper(t); }
var M = function (_Map) { function M() { _classCallCheck(this, M); return _callSuper(this, M, arguments); } _inherits(M, _Map); M.prototype.getOr = function (k, d) { return this.has(k) ? this.get(k) : d; }; return M; }(_wrapNativeSuper(Map));
var m = new M([[1, "one"]]);
exports.ok = [m.getOr(1, "d"), m.getOr(2, "d"), m instanceof Map, m.size];
`,
  }),
  ...inBothModes("error-call", "id_error_call", {
    "index.js": `function MyError(m) { var e = Error.call(this, m); this.message = m; this.stack = e.stack; this.name = "MyError"; }
MyError.prototype = Object.create(Error.prototype);
MyError.prototype.constructor = MyError;
var e = new MyError("m");
exports.ok = [e.message, e instanceof Error, String(e), typeof e.stack, Object.keys(e).sort()];
`,
  }),
  ...inBothModes("class-error", "id_class_error", {
    "index.js": `class MyError extends Error { constructor(m, code) { super(m); this.name = this.constructor.name; this.code = code; Error.captureStackTrace && Error.captureStackTrace(this, this.constructor); Object.setPrototypeOf(this, new.target.prototype); } }
class Deeper extends MyError { get isDeep() { return true; } }
var e = new Deeper("m", 5);
exports.ok = [e.name, e.code, e.isDeep, e instanceof MyError, e instanceof Error, String(e), e.stack.split("\\n")[0], Object.keys(e).sort(), JSON.stringify(e)];
`,
  }),
  ...inBothModes("mixin-assign-to-class", "id_mixin_assign_to_class", {
    "index.js": `class K { base() { return "base"; } }
Object.assign(K.prototype, { mixed() { return "mixed " + this.base(); }, n: 1 });
exports.ok = [new K().mixed(), new K().n, Object.keys(K.prototype)];
`,
  }),
  ...inBothModes("mixin-emitter-to-class", "id_mixin_emitter_to_class", {
    "index.js": `var EventEmitter = require("node:events");
class K {}
Object.assign(K.prototype, EventEmitter.prototype);
var k = new K(); var got;
k.on("x", function (v) { got = v; }); k.emit("x", 5);
exports.ok = [got, typeof k.on];
`,
  }),
  ...inBothModes("method-added-to-class", "id_method_added_to_class", {
    "index.js": `class K { a() { return "a"; } }
K.prototype.b = function () { return "b" + this.a(); };
K.prototype.c = 5;
K.stat = function () { return "stat"; };
K.displayName = "Shown";
exports.ok = [new K().b(), new K().c, K.stat(), K.displayName, Object.keys(K), Object.keys(K.prototype)];
`,
  }),
  ...inBothModes("method-replaced-on-class", "id_method_replaced_on_class", {
    "index.js": `class K { m(x) { return "orig" + x; } static s() { return "orig s"; } get g() { return "orig g"; } }
var before = new K();
var orig = K.prototype.m;
K.prototype.m = function (x) { return "wrapped(" + orig.call(this, x) + ")"; };
K.s = function () { return "new s"; };
Object.defineProperty(K.prototype, "g", { get() { return "new g"; }, configurable: true });
exports.ok = [before.m(1), new K().m(2), K.s(), before.g];
exports.K = K;
`,
  }),
  ...inBothModes("method-deleted-from-class", "id_method_deleted_from_class", {
    "index.js": `class B { m() { return "B.m"; } }
class K extends B { m() { return "K.m"; } }
var k = new K(); var first = k.m();
delete K.prototype.m;
exports.ok = [first, k.m(), "m" in k];
`,
  }),
  ...inBothModes("prototype-swapped-on-class", "id_prototype_swapped_on_class", {
    "index.js": `class A { m() { return "A"; } }
class B { m() { return "B"; } }
class K extends A {}
var k = new K(); var first = k.m();
Object.setPrototypeOf(K.prototype, B.prototype);
exports.ok = [first, k.m(), k instanceof A, k instanceof B];
`,
  }),
  ...inBothModes("instance-prototype-swapped", "id_instance_prototype_swapped", {
    "index.js": `class A { m() { return "A"; } }
class B { m() { return "B"; } }
var a = new A(); a.x = 1;
Object.setPrototypeOf(a, B.prototype);
var c = new A(); c.__proto__ = B.prototype;
exports.ok = [a.m(), a.x, a instanceof B, a instanceof A, c.m()];
`,
  }),
  ...inBothModes("own-method-over-class", "id_own_method_over_class", {
    "index.js": `class K { m() { return "proto"; } }
var k = new K(); k.m = function () { return "own"; };
var j = new K();
exports.ok = [k.m(), j.m(), Object.keys(k), delete k.m, k.m()];
`,
  }),
  ...inBothModes("constructor-returns-other", "id_constructor_returns_other", {
    "index.js": `class K { constructor(x) { if (x) return { other: true }; this.mine = true; } }
function F(x) { if (x) return [1, 2]; this.mine = true; }
class Cache { constructor(k) { if (Cache.seen[k]) return Cache.seen[k]; Cache.seen[k] = this; this.k = k; } }
Cache.seen = {};
exports.ok = [new K(1), new K(0), new K(1) instanceof K, new F(1), new F(0), new Cache("a") === new Cache("a")];
`,
  }),
  ...inBothModes("callable-without-new", "id_callable_without_new", {
    "index.js": `function K(x) { if (!(this instanceof K)) return new K(x); this.x = x; }
K.prototype.m = function () { return this.x; };
function N(x) { if (!new.target) return new N(x); this.x = x; }
exports.ok = [K(1).m(), new K(2).m(), N(3).x, K.call({}, 4).m()];
`,
  }),
  ...inBothModes("define-in-constructor", "id_define_in_constructor", {
    "index.js": `class K { constructor() { Object.defineProperty(this, "hidden", { value: 1, enumerable: false }); Object.defineProperty(this, "g", { get() { return this.hidden + 1; }, enumerable: true }); this.plain = 0; } }
var k = new K();
exports.ok = [k.hidden, k.g, Object.keys(k), JSON.stringify(k), (function () { try { k.hidden = 5; } catch (e) { return e.name; } return k.hidden; })()];
`,
  }),
  ...inBothModes("freeze-this", "id_freeze_this", {
    "index.js": `class K { constructor() { this.a = 1; Object.freeze(this); } }
var k = new K();
exports.ok = [Object.isFrozen(k), (function () { try { k.a = 2; k.b = 3; } catch (e) { return e.name; } return "silent"; })(), k.a, k.b];
`,
  }),
  ...inBothModes("dynamic-members", "id_dynamic_members", {
    "index.js": `class K {}
var k = new K();
for (var i = 0; i < 5; i++) k["p" + i] = i;
delete k.p2;
k[Symbol.for("s")] = "sym";
k[3] = "three"; k[1] = "one";
exports.ok = [Object.keys(k), JSON.stringify(k), k[Symbol.for("s")], "p2" in k];
`,
  }),
  ...inBothModes("define-properties-on-prototype", "id_define_properties_on_prototype", {
    "index.js": `function K() { this._v = 1; }
Object.defineProperties(K.prototype, { v: { get: function () { return this._v; }, set: function (x) { this._v = x * 2; }, enumerable: true }, ro: { value: "ro" } });
K.prototype.__defineGetter__("old", function () { return "old getter"; });
var k = new K(); k.v = 5;
exports.ok = [k.v, k.ro, k.old, Object.keys(k), (function () { var r = []; for (var p in k) r.push(p); return r; })()];
`,
  }),
  ...inBothModes("symbols-on-class", "id_symbols_on_class", {
    "index.js": `class K { constructor(n) { this.n = n; } static [Symbol.hasInstance](x) { return x === 5; } [Symbol.toPrimitive](hint) { return hint === "number" ? this.n : "K" + this.n; } *[Symbol.iterator]() { yield this.n; yield this.n + 1; } get [Symbol.toStringTag]() { return "Kay"; } toJSON() { return { json: this.n }; } }
var k = new K(2);
exports.ok = [5 instanceof K, k instanceof K, +k, \`\${k}\`, k + "", [...k], Object.prototype.toString.call(k), JSON.stringify({ k })];
`,
  }),
  ...inBothModes("arguments-idioms", "id_arguments_idioms", {
    "index.js": `function a() { return Array.prototype.slice.call(arguments, 1); }
function b() { return [].concat.apply([], arguments); }
function c() { return a.apply(this, arguments); }
function d(x, cb) { if (typeof x === "function") { cb = x; x = "dflt"; } return cb(x); }
function e() { var n = arguments.length; var r = new Array(n); for (var i = 0; i < n; i++) r[i] = arguments[i]; return r; }
function f(x) { return arguments.length + ":" + f.length; }
exports.ok = [a(1, 2, 3), b([1], [2]), c(1, 2), d(function (v) { return v; }), d("x", function (v) { return v; }), e(1, undefined), f(), f(1, 2)];
`,
  }),
  ...inBothModes("function-in-block", "id_function_in_block", {
    "index.js": `var r = [];
r.push(typeof hoisted);
if (true) { function hoisted() { return "in block"; } }
r.push(typeof hoisted);
{ function second() { return 1; } }
r.push(typeof second);
function outer() { if (false) { function never() {} } return typeof never; }
r.push(outer());
exports.ok = r;
`,
  }),
  ...inBothModes("getter-on-module-exports", "id_getter_on_module_exports", {
    "index.js": `var n = 0;
Object.defineProperty(module, "exports", { get: function () { return { ok: ["through a getter", ++n] }; } });
`,
  }),
  ...inBothModes("bind-call-apply", "id_bind_call_apply", {
    "index.js": `class K { constructor() { this.v = "k"; this.bound = this.m.bind(this); } m(a, b) { return [this && this.v, a, b]; } }
var k = new K(); var m = k.m; var bound = k.bound;
exports.ok = [bound(1, 2), k.m.call({ v: "other" }, 1), k.m.apply({ v: "arr" }, [1, 2]), (function () { try { return m(1); } catch (e) { return e.name; } })(), K.prototype.m.bind({ v: "b" }, "pre")("post"), bound.name, bound.length];
`,
  }),
  ...inBothModes("private-by-weakmap", "id_private_by_weakmap", {
    "index.js": `var _p = new WeakMap();
var __classPrivateFieldGet = function (receiver, state) { if (!state.has(receiver)) throw new TypeError("no"); return state.get(receiver); };
class K { constructor(v) { _p.set(this, v); } get() { return __classPrivateFieldGet(this, _p); } }
exports.ok = [new K(5).get(), (function () { try { return K.prototype.get.call({}); } catch (e) { return e.message; } })()];
`,
  }),
  ...inBothModes("decorate-helper", "id_decorate_helper", {
    "index.js": `var __decorate = function (decorators, target, key, desc) { var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d; for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r; return c > 3 && r && Object.defineProperty(target, key, r), r; };
function log(t, k, d) { var o = d.value; d.value = function () { return "logged " + o.apply(this, arguments); }; return d; }
function sealed(c) { c.sealed = true; return c; }
let K = class K { m() { return "m"; } };
__decorate([log], K.prototype, "m", null);
K = __decorate([sealed], K);
exports.ok = [new K().m(), K.sealed];
`,
  }),
  {
    name: "from-outside",
    files: {
      ...pkg("bend", {
        "index.js": `"use strict";
class K { constructor(v) { this.v = v; } m(x) { return "orig" + this.v + x; } twice(x) { return this.m(x) + this.m(x); } static make(v) { return new K(v); } }
function F(v) { this.v = v; }
F.prototype.m = function (x) { return "origF" + this.v + x; };
F.prototype.twice = function (x) { return this.m(x) + this.m(x); };
exports.K = K; exports.F = F;
exports.helper = function helper() { return "helper"; };
exports.useHelper = function () { return exports.helper() + "!"; };
exports.obj = { m() { return "obj.m"; }, use() { return this.m() + "!"; } };
`,
        "index.mjs": `export class K { constructor(v) { this.v = v; } m(x) { return "orig" + this.v + x; } twice(x) { return this.m(x) + this.m(x); } static make(v) { return new K(v); } }
export function F(v) { this.v = v; }
F.prototype.m = function (x) { return "origF" + this.v + x; };
F.prototype.twice = function (x) { return this.m(x) + this.m(x); };
export const obj = { m() { return "obj.m"; }, use() { return this.m() + "!"; } };
`,
        "index.d.ts": `export declare class K { constructor(v: number); v: number; m(x: number): string; twice(x: number): string; static make(v: number): K }
export declare class F { constructor(v: number); v: number; m(x: number): string; twice(x: number): string }
export declare const obj: { m(): string; use(): string };
`,
      }, {"main": "./index.js", "exports": {".": {"types": "./index.d.ts", "import": "./index.mjs", "require": "./index.js"}}}),
    },
    importers: {
      "esm.mjs": `import { K, F, obj } from "bend";
${js}const before = new K(1);
const orig = K.prototype.m;
t("patch", () => { K.prototype.m = function (x) { return "W(" + orig.call(this, x) + ")"; }; return "patched"; });
t("K", () => [before.m(1), new K(2).twice(3), K.make(4).m(5)]);
t("add", () => { K.prototype.extra = function () { return "extra" + this.v; }; return new K(6).extra(); });
t("static", () => { K.make = () => "no more"; return K.make(1); });
const origF = F.prototype.m;
t("patchF", () => { F.prototype.m = function (x) { return "W(" + origF.call(this, x) + ")"; }; return new F(1).twice(2); });
t("obj", () => { obj.m = () => "patched obj.m"; return obj.use(); });
`,
      "cjs.cjs": `${js}const { K, F, obj } = require("bend");
const before = new K(1);
const orig = K.prototype.m;
t("patch", () => { K.prototype.m = function (x) { return "W(" + orig.call(this, x) + ")"; }; return "patched"; });
t("K", () => [before.m(1), new K(2).twice(3), K.make(4).m(5)]);
t("add", () => { K.prototype.extra = function () { return "extra" + this.v; }; return new K(6).extra(); });
t("static", () => { K.make = () => "no more"; return K.make(1); });
const origF = F.prototype.m;
t("patchF", () => { F.prototype.m = function (x) { return "W(" + origF.call(this, x) + ")"; }; return new F(1).twice(2); });
t("obj", () => { obj.m = () => "patched obj.m"; return obj.use(); });
const b = require("bend");
t("export replaced", () => { b.helper = () => "mocked"; return b.useHelper(); });
`,
      "typed.ts": `import { K, F, obj } from "bend";
${ts}const before = new K(1);
const orig = K.prototype.m;
t("patch", () => { K.prototype.m = function (this: any, x: number) { return "W(" + orig.call(this, x) + ")"; }; return "patched"; });
t("K", () => [before.m(1), new K(2).twice(3), K.make(4).m(5)]);
t("add", () => { (K.prototype as any).extra = function (this: any) { return "extra" + this.v; }; return (new K(6) as any).extra(); });
t("static", () => { (K as any).make = () => "no more"; return K.make(1); });
const origF = F.prototype.m;
t("patchF", () => { F.prototype.m = function (this: any, x: number) { return "W(" + origF.call(this, x) + ")"; }; return new F(1).twice(2); });
t("obj", () => { obj.m = () => "patched obj.m"; return obj.use(); });
`,
      "subclass.mjs": `import { K, F } from "bend";
${js}class L extends K { m(x) { return "L<" + super.m(x); } }
class G extends F { m(x) { return "G<" + super.m(x); } }
t("x", () => [new L(1).twice(2), new G(1).twice(2), new L(1) instanceof K, L.make(3).constructor.name]);
`,
      "subclass.ts": `import { K, F } from "bend";
${ts}class L extends K { extra = 1; m(x: number): string { return "L<" + super.m(x); } }
class G extends F { m(x: number): string { return "G<" + super.m(x); } }
t("x", () => [new L(1).twice(2), new G(1).twice(2), new L(1) instanceof K, new L(1).extra, L.make(3).constructor.name, Object.keys(new L(5))]);
`,
    },
  },
];
