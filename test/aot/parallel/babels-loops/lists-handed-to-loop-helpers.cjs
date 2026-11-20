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
  function Stall(goods) { this.goods = goods; this.day = null; this.shut = 0; }
  Stall.prototype.serve = function (hour) { return exports._serve.call(this, this.day[hour]); };
  function _serve(clerks) {
    if (!clerks) return "nobody";
    var served = 0;
    for (var _iterator = _createForOfIteratorHelperLoose(clerks), _step; !(_step = _iterator()).done;) {
      var clerk = _step.value;
      if (typeof clerk === "function") served += clerk(this.goods, this) ? 2 : 1;
      else served -= 1;
      if (this.shut === 1) return "shut behind " + served;
    }
    return served;
  }
  exports._serve = _serve;
  exports.Stall = Stall;
})(exports);
let calls = 0;
const day = { morning: [function () { calls++; }, null, function (goods) { calls += goods.weight; }], evening: new Set([function (goods, stall) { stall.shut = calls % 7 === 0 ? 1 : 0; return stall.goods === goods; }]), none: undefined, text: "" };
let stopped = 0;
for (let k = 0; k < 4000; k++) {
  const stall = new globalThis.evaluated.Stall({ weight: k & 3 });
  stall.day = day;
  for (const hour of ["morning", "evening", "none", "text"]) { const told = stall.serve(hour); stopped += typeof told === "string" ? told.length : told; }
}
console.log(calls, stopped);
