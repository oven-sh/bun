// STATISTIC: KnownHelperCalls >= 5
// Babel's loose loop helper in its forms, over lists that iterate plainly and over everything else.
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
  if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) {
    t && (r = t);
    var o = 0;
    return function () { return o >= r.length ? { done: !0 } : { done: !1, value: r[o++] }; };
  }
  throw new TypeError("Invalid attempt to iterate non-iterable instance.");
}
function odd(r) {
  var t = "function" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (t) return (t = t.call(r)).next.bind(t);
  throw new TypeError("odd");
}
function overOdd(list) {
  var out = "";
  for (var _iterator12 = odd(list), _step12; !(_step12 = _iterator12()).done;) { var it = _step12.value; out += it; }
  return out;
}
function older(o, allowArrayLike) {
  var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];
  if (it) { return (it = it.call(o)).next.bind(it); }
  throw new TypeError("older");
}
function join(list) {
  var out = "";
  for (var _iterator = _createForOfIteratorHelperLoose(list), _step; !(_step = _iterator()).done;) {
    var value = _step.value;
    if (value === "skip") continue;
    if (value === "stop") break;
    out += String(value) + ",";
  }
  return out;
}
function nested(lists) {
  var sum = 0;
  for (var _iterator2 = older(lists), _step2; !(_step2 = _iterator2()).done;) {
    var list = _step2.value;
    for (var _iterator3 = _createForOfIteratorHelperLoose(list, true), _step3; !(_step3 = _iterator3()).done;) {
      var _step3$value = _step3.value, key = _step3$value[0], at = _step3$value[1];
      sum += key.length * at;
    }
  }
  return sum;
}
function grows(list) {
  var seen = [];
  for (var _iterator4 = _createForOfIteratorHelperLoose(list), _step4; !(_step4 = _iterator4()).done;) {
    seen.push(_step4.value);
    if (seen.length < 3) list.push(_step4.value * 10);
    if (seen.length === 4) list.length = 4;
  }
  return seen.join();
}
function throwsInside(list) {
  try {
    for (var _iterator5 = _createForOfIteratorHelperLoose(list), _step5; !(_step5 = _iterator5()).done;) {
      var item = _step5.value;
      if (item > 1) throw new Error("at " + item);
    }
  } catch (error) { return error.message; }
  return "none";
}
function captured(list) {
  var made = [];
  var _loop = function _loop() { var it = _step6.value; made.push(function () { return it; }); };
  for (var _iterator6 = _createForOfIteratorHelperLoose(list), _step6; !(_step6 = _iterator6()).done;) { _loop(); }
  return made.map(function (f) { return f(); }).join();
}
function after(list) {
  for (var _iterator7 = _createForOfIteratorHelperLoose(list), _step7; !(_step7 = _iterator7()).done;) { if (_step7.value === 2) break; }
  return JSON.stringify(_step7) + typeof _iterator7;
}
function called(list) {
  var out = [];
  for (var _iterator8 = _createForOfIteratorHelperLoose(list), _step8; !(_step8 = _iterator8()).done;) { out.push(typeof _step8.value()); }
  return out.join();
}
function swapped(list, other) {
  var out = [];
  for (var _iterator9 = _createForOfIteratorHelperLoose(list), _step9; !(_step9 = _iterator9()).done;) {
    var taken = _step9.value;
    list = other;
    out.push(taken, _step9.value);
  }
  return out.join();
}
console.log(join(["a", "skip", "b", "stop", "c"]), join([]), join([, 1, , 2]), join(new Set([1, 2, "stop"])), join(new Map([[1, 2]])), join("text"));
console.log(join(new Uint8Array([3, 4])), join({ [Symbol.iterator]: function () { var n = 0; return { next: function () { return { done: n > 2, value: n++ }; } }; } }));
console.log(nested([[["ab", 2], ["c", 3]], new Map([["key", 4]])]), nested([]), nested(new Set([[["x", 1]]])));
console.log(grows([1]), grows([1, 2, 3, 4, 5, 6, 7]), throwsInside([1, 2, 3]), throwsInside([0]), captured([1, 2]), after([1, 2, 3]), after([]), called([function () { return this; }]));
console.log(swapped([1, 2], [3]), swapped(new Set([1, 2]), [3]));
for (const bad of [null, undefined, 1, {}, { [Symbol.iterator]: 5 }, { [Symbol.iterator]: function () { return {}; } }, { [Symbol.iterator]: function () { return { next: function () {} }; } }]) {
  try { console.log(join(bad)); } catch (error) { console.log(error.name, error.message.slice(0, 60)); }
}
class Own extends Array {}
class Reversed extends Array { *[Symbol.iterator]() { for (let k = this.length; k--;) yield this[k]; } }
console.log(join(Own.from([1, 2])), join(Reversed.from([1, 2, 3])));
const other = [1, 2, 3];
other[Symbol.iterator] = function () { return [7, 8][Symbol.iterator](); };
console.log(join(other));
let reads = 0;
const watched = [1, 2];
Object.defineProperty(watched, Symbol.iterator, { get() { reads++; return Array.prototype.values; } });
console.log(join(watched), reads);
const log = [];
const proxy = new Proxy([1, 2], { get(target, key) { log.push(String(key)); return target[key]; } });
console.log(join(proxy), log.join());
const below = Object.setPrototypeOf([1, 2], { __proto__: Array.prototype, [Symbol.iterator]: function () { return [9][Symbol.iterator](); } });
console.log(join(below), join(Object.setPrototypeOf([5], null) instanceof Object ? [] : [6]));
const getters = [1, 2, 3];
Object.defineProperty(getters, 1, { get() { getters.length = 2; return "got"; } });
console.log(join(getters), join(Object.freeze([1, 2])), join([1.5, "x", null, undefined, {}]));
const lazy = { [Symbol.iterator]: function () { var n = 0; return { next: function () { n++; return { get done() { log.push("done"); return n > 2; }, get value() { log.push("value"); return n; } }; } }; } };
log.length = 0;
console.log(join(lazy), log.join());
try { console.log(overOdd([1, 2])); } catch (error) { console.log(error.message); }
const odds = [1]; odds["@@iterator"] = function () { return [8, 9][Symbol.iterator](); };
console.log(overOdd(odds));
let opened = 0;
function opens(make) {
  var sum = 0;
  for (var _iterator10 = _createForOfIteratorHelperLoose((opened++, make())), _step10; !(_step10 = _iterator10()).done;) { var it = _step10.value; sum += it; }
  for (var _iterator11 = _createForOfIteratorHelperLoose(opened++ ? make() : []), _step11; !(_step11 = _iterator11()).done;) sum += _step11.value;
  return sum;
}
console.log(opens(() => [1, 2]), opened, opens(() => new Set([3, 4])), opened, opens(function* () { yield 5; }), opened);
let total = 0;
for (let k = 0; k < 3000; k++) total += join([k, k + 1, k & 7 ? "x" : "skip"]).length + nested([[["ab", k]]]);
console.log(total);
