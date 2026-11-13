// What Babel's loop helper is handed is a list, though the helper asks whether it is text.
globalThis.evaluated = new Function("f", "return f" + (process.argv.length > 100 ? 1 : ""))(exports);
(function (exports) {
  function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
  function _unsupportedIterableToArray(r, a) {
    if (r) {
      if ("string" == typeof r) return _arrayLikeToArray(r, a);
      var t = {}.toString.call(r).slice(8, -1);
      return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
    }
  }
  function _createForOfIteratorHelperLoose(r, e) {
    var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
    if (t) return (t = t.call(r)).next.bind(t);
    if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e) {
      t && (r = t);
      var o = 0;
      return function () { return o >= r.length ? { done: !0 } : { done: !1, value: r[o++] }; };
    }
    throw new TypeError("Invalid attempt to iterate non-iterable instance.");
  }
  function Path(node) { this.node = node; this.state = null; this.flags = 0; }
  Path.prototype.call = function (key) { return exports._call.call(this, this.state[key]); };
  function _call(fns) {
    if (!fns) return false;
    for (var _iterator = _createForOfIteratorHelperLoose(fns), _step; !(_step = _iterator()).done;) {
      var fn = _step.value;
      if (!fn) continue;
      var node = this.node;
      if (!node) return true;
      var ret = fn.call(this.state, this, this.state);
      if (ret) throw new Error("Unexpected return value");
      if (this.node !== node) return true;
      if (this.flags > 0) return true;
    }
    return false;
  }
  exports._call = _call;
  exports.Path = Path;
})(exports);
let calls = 0;
const state = { enter: [function () { calls++; }, null, function (path) { calls += path.node.weight; }], exit: new Set([function (path) { path.flags = calls % 7 === 0 ? 1 : 0; }]), none: undefined, text: "" };
let stopped = 0;
for (let k = 0; k < 4000; k++) {
  const path = new globalThis.evaluated.Path({ weight: k & 3 });
  path.state = state;
  for (const key of ["enter", "exit", "none", "text"]) if (path.call(key)) stopped++;
}
console.log(calls, stopped);
