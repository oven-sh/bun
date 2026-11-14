// STATISTIC: KnownHelperCalls >= 3
// Babel's class helper, declared inside a function and without its static side, defines what is written.
(function (exports) {
  function _createClass(e, r, t) {
    return r && _defineProperties(e.prototype, r), Object.defineProperty(e, "prototype", {
      writable: !1
    }), e;
  }
  function _defineProperties(e, r) {
    for (var t = 0; t < r.length; t++) {
      var o = r[t];
      o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);
    }
  }
  function _toPrimitive(t, r) {
    if ("object" != typeof t || !t) return t;
    var e = t[Symbol.toPrimitive];
    if (void 0 !== e) {
      var i = e.call(t, r);
      if ("object" != typeof i) return i;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (String )(t);
  }
  function _toPropertyKey(t) {
    var i = _toPrimitive(t, "string");
    return "symbol" == typeof i ? i : i + "";
  }
  var Path = function () {
    function Path(x) { this._flags = x; this.node = { x: x }; }
    var _proto = Path.prototype;
    _proto.get = function get() { return this._flags; };
    return _createClass(Path, [{
      key: "removed",
      get: function get() { return (this._flags & 1) > 0; },
      set: function set(v) { if (v) this._flags |= 1; else this._flags &= -2; }
    }, {
      key: "list",
      get: function get() { return this.node.x > 2 ? [this.node.x] : null; }
    }, {
      key: "name",
      value: function name() { return "name" + this._flags; }
    }, {
      key: "constant",
      value: 7,
      enumerable: true
    }]);
  }();
  var Empty = function () { function Empty() {} return _createClass(Empty); }();
  var Derived = function (_Path) {
    function Derived(x) { var _this = _Path.call(this, x) || this; _this.own = 1; return _this; }
    Derived.prototype = Object.create(_Path.prototype, { constructor: { value: Derived, writable: true, configurable: true } });
    return _createClass(Derived, [{ key: "removed", get: function get() { return "derived" + this._flags; } }]);
  }(Path);
  exports.run = function (count) {
    var seen = 0, names = "";
    for (var i = 0; i < count; i++) {
      var path = i % 5 ? new Path(i) : new Derived(i);
      if (path.removed === true) seen++;
      try { path.removed = i % 3 === 0; } catch (error) { names += error.name; if (names.length > 40) names = ""; }
      seen += path.get() + (path.list ? path.list[0] : 0) + path.constant;
      if (i % 100 === 0) names += path.name() + path.removed;
    }
    return seen + names;
  };
  exports.describe = function () {
    var out = [];
    [Path, Empty, Derived].forEach(function (C) {
      out.push(JSON.stringify(Object.getOwnPropertyDescriptor(C, "prototype")).slice(-60), Object.getOwnPropertyNames(C.prototype).join(), Object.keys(C.prototype).join());
      Object.getOwnPropertyNames(C.prototype).forEach(function (name) {
        var d = Object.getOwnPropertyDescriptor(C.prototype, name);
        out.push(name, typeof d.get, typeof d.set, typeof d.value, d.enumerable, d.configurable, d.writable, (d.get || d.value || {}).name);
      });
    });
    var later = new Path(3);
    Object.defineProperty(Path.prototype, "removed", { get: function () { return "later"; }, configurable: true });
    out.push(later.removed, later.list);
    delete Path.prototype.list;
    out.push(later.list, "list" in later);
    return out.join(" ");
  };
})(exports);
console.log(exports.run(1000));
console.log(exports.describe());
console.log(exports.run(20));
