// RUN: lower
// OPTIONS: builtin-modules

// Babel class helpers with honest and odd callers.
"use strict";

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function _possibleConstructorReturn(t, e) { if (e && ("object" == _typeof(e) || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); return _assertThisInitialized(t); }
function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); return e; }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} return (_isNativeReflectConstruct = function _isNativeReflectConstruct() { return !!t; })(); }
function _getPrototypeOf(t) { return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) { return t.__proto__ || Object.getPrototypeOf(t); }, _getPrototypeOf(t); }
function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }
function _setPrototypeOf(t, e) { return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, _setPrototypeOf(t, e); }

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

var Reader = function () {
  function Reader(pages) {
    _classCallCheck(this, Reader);
    this.pages = pages;
  }
  return _createClass(Reader, [{
    key: "read",
    value: function read() {
      return "read " + this.pages + " pages";
    }
  }, {
    key: "half",
    get: function get() {
      return this.pages / 2;
    },
    set: function set(value) {
      this.pages = value * 2;
    }
  }], [{
    key: "open",
    value: function open(pages) {
      return new this(pages);
    }
  }]);
}();

var Skimmer = function (_Reader) {
  function Skimmer(pages, speed) {
    var _this;
    _classCallCheck(this, Skimmer);
    _this = _callSuper(this, Skimmer, [pages]);
    _this.speed = speed;
    return _this;
  }
  _inherits(Skimmer, _Reader);
  return _createClass(Skimmer, [{
    key: "read",
    value: function read() {
      return "skimmed " + this.pages + " pages at " + this.speed;
    }
  }]);
}(Reader);

function readOf(reader) {
  return reader.read();
}

function halfOf(reader) {
  return reader.half;
}

function setHalf(reader, value) {
  reader.half = value;
  return reader.pages;
}

var length = 0;
for (var i = 0; i < 2000; i++) {
  var honest = i % 2 ? new Reader(i % 8) : new Skimmer(i % 8, 2);
  length += readOf(honest).length + halfOf(honest) + setHalf(honest, 3);
}
console.log("2000 honest readers", length);

attempt("a reader", function () { return new Reader(10); });
attempt("a skimmer", function () { return new Skimmer(10, 2); });
attempt("keys of the prototype", function () { return Object.keys(Reader.prototype); });
attempt("own names of the prototype", function () { return Object.getOwnPropertyNames(Reader.prototype); });
attempt("for-in over a skimmer", function () { var names = []; for (var name in new Skimmer(1, 2)) names.push(name); return names; });
attempt("a static through the child", function () { return Skimmer.open(6) instanceof Skimmer; });
attempt("Reader without new", function () { return Reader(1); });
attempt("Reader.call with a literal", function () { return Reader.call({}, 1); });
attempt("Reader.call with a reader", function () { var reader = new Reader(1); Reader.call(reader, 2); return reader; });
attempt("Reader.call with a skimmer", function () { var skimmer = new Skimmer(1, 1); Reader.call(skimmer, 2); return skimmer; });
attempt("Reader.call with an object made from its prototype", function () { var made = Object.create(Reader.prototype); Reader.call(made, 2); return readOf(made); });
attempt("Skimmer.call with a reader", function () { return Skimmer.call(new Reader(1), 2, 3); });
attempt("a store to Reader.prototype", function () { Reader.prototype = {}; return "stored"; });
attempt("Reflect.construct of Reader for Skimmer", function () { return readOf(Reflect.construct(Reader, [5], Skimmer)); });
attempt("Reflect.construct of Skimmer for Reader", function () { return readOf(Reflect.construct(Skimmer, [5, 6], Reader)); });

var impostors = [
  ["a literal with pages", { pages: 10 }],
  ["a literal with pages and read", { pages: 10, read: function () { return "its own read"; } }],
  ["a literal with its own half", { pages: 10, half: "own half", read: Reader.prototype.read }],
  ["a reader whose half was shadowed", Object.defineProperty(new Reader(10), "half", { value: "shadow", writable: true })],
  ["a frozen reader", Object.freeze(new Reader(10))],
  ["a reader moved under Skimmer", Object.setPrototypeOf(new Reader(10), Skimmer.prototype)],
  ["a skimmer moved under Object", Object.setPrototypeOf(new Skimmer(10, 2), Object.prototype)],
];
impostors.forEach(function (pair) {
  attempt(pair[0] + ": read()", function () { return readOf(pair[1]); });
  attempt(pair[0] + ": half", function () { return halfOf(pair[1]); });
  attempt(pair[0] + ": half = 7", function () { return setHalf(pair[1], 7); });
  attempt(pair[0] + ": now", function () { return pair[1]; });
  attempt("honest again", function () { return [readOf(new Reader(4)), halfOf(new Reader(4)), setHalf(new Reader(4), 1)]; });
});

// GENERATED: _isNativeReflectConstruct _getPrototypeOf get set
// CHECK-LABEL: function {{*}}name="_isNativeReflectConstruct"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5(v1):
// CHECK-NEXT: v2 = Builtin builtin=BooleanPrototypeValueOf
// CHECK-NEXT: v3 = PropGet v2 key="call"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(FunctionPrototypeCall) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=Reflect
// CHECK-NEXT: v6 = Builtin builtin=ReflectConstruct
// CHECK-NEXT: v7 = Builtin builtin=Boolean
// CHECK-NEXT: v8 = Data data=[[d_3]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v10 = NewClosure function=[[f_4]]
// CHECK-NEXT: v11 = Call v6, v5, v7, v9, v10 calleeName="Reflect.construct" [isDoneInPlace]
// CHECK-NEXT: v12 = Call v4, v2, v11 calleeKey="call" calleeName="Boolean.prototype.valueOf.call"
// CHECK-NEXT: v13 = Convert v12 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v14 = ToBoolean v13
// CHECK-NEXT: v15 = LogicalNot v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5(v16):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b5(v17) role=CatchHandler:
// CHECK-NEXT: v18 = CatchValue
// CHECK-NEXT: Jump -> next b6(v17)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = NewClosure v19 function=[[f_5]]
// CHECK-NEXT: PutEnvironmentField v0, v20 layout=[[L_1]] field=6
// CHECK-NEXT: v22 = Call v20
// CHECK-NEXT: ReturnCall v22 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="_getPrototypeOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=ObjectSetPrototypeOf
// CHECK-NEXT: v3 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v4 = PropGet v3 key="bind"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(FunctionPrototypeBind) flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3 calleeKey="bind" calleeName="Object.getPrototypeOf.bind"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: PutEnvironmentField v0, v7 layout=[[L_1]] field=7
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_1]] field=7
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v10, -, v1 calleeName="_getPrototypeOf"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="_isNativeReflectConstruct"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=undefined|boolean flags=[IsExpected]}] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: v3 = LogicalNot v2
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: v5 = LogicalNot v4
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] thisType={type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="pages"
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Div v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_8]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Mul v2, v3
// CHECK-NEXT: PropSet v0, v4 key="pages"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
