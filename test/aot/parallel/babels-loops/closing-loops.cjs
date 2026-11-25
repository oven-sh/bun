// STATISTIC: KnownHelperCalls >= 6
// Babel's loops that close their iterators, over lists that iterate plainly and over everything else.
function _createForOfIteratorHelper(r, e) {
  var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (!t) {
    if (Array.isArray(r) || e && r && "number" == typeof r.length) {
      t && (r = t);
      var _n = 0, F = function F() {};
      return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F };
    }
    throw new TypeError("Invalid attempt to iterate non-iterable instance.");
  }
  var o, a = !0, u = !1;
  return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t.return || t.return(); } finally { if (u) throw o; } } };
}
function older(o, allowArrayLike) {
  var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];
  if (!it) { throw new TypeError("older"); }
  var normalCompletion = true, didErr = false, err;
  return { s: function () { it = it.call(o); }, n: function () { var step = it.next(); normalCompletion = step.done; return step; }, e: function (e) { didErr = true; err = e; }, f: function () { try { if (!normalCompletion && it.return != null) it.return(); } finally { if (didErr) throw err; } } };
}
var counted = 0;
function counting(o) {
  var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];
  if (!it) { throw new TypeError("counting"); }
  var done = true, failed = false, err;
  return { s: function () { it = it.call(o); }, n: function () { var step = it.next(); done = step.done; return step; }, e: function (e) { failed = true; err = e; }, f: function () { counted++; try { if (!done && it.return != null) it.return(); } finally { if (failed) throw err; } } };
}
function swallowing(o) {
  var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];
  if (!it) { throw new TypeError("swallowing"); }
  var done = true, failed = false, err;
  return { s: function () { it = it.call(o); }, n: function () { var step = it.next(); done = step.done; return step; }, e: function (e) { failed = false; err = e; }, f: function () { try { if (!done && it.return != null) it.return(); } finally { if (failed) throw err; } } };
}
var log = [];
function join(list) {
  var out = "";
  var _iterator = _createForOfIteratorHelper(list), _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var value = _step.value;
      if (value === "skip") continue;
      if (value === "stop") break;
      if (value === "throw") throw new Error("inside");
      if (value === "return") return out + "returned";
      out += String(value) + ",";
    }
  } catch (err) { _iterator.e(err); } finally { _iterator.f(); }
  return out;
}
function nested(lists) {
  var sum = 0;
  var _iterator2 = older(lists), _step2;
  try {
    outer: for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
      var list = _step2.value;
      var _iterator3 = _createForOfIteratorHelper(list, true), _step3;
      try {
        for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
          var _step3$value = _step3.value, key = _step3$value[0], at = _step3$value[1];
          if (key === "next") continue outer;
          if (key === "end") break outer;
          sum += key.length * at;
        }
      } catch (err) { _iterator3.e(err); } finally { _iterator3.f(); }
      sum += 1000;
    }
  } catch (err) { _iterator2.e(err); } finally { _iterator2.f(); }
  return sum;
}
function counts(list) {
  var n = 0, _iterator4 = counting(list), _step4;
  try { for (_iterator4.s(); !(_step4 = _iterator4.n()).done;) { var it = _step4.value; n += it; } } catch (err) { _iterator4.e(err); } finally { _iterator4.f(); }
  return n;
}
function swallows(list) {
  var n = 0;
  var _iterator5 = swallowing(list), _step5;
  try { for (_iterator5.s(); !(_step5 = _iterator5.n()).done;) { var it = _step5.value; if (it === 2) throw new Error("swallowed"); n += it; } } catch (err) { _iterator5.e(err); } finally { _iterator5.f(); }
  return n;
}
function catches(list) {
  try {
    var _iterator6 = _createForOfIteratorHelper(list), _step6;
    try { for (_iterator6.s(); !(_step6 = _iterator6.n()).done;) { var it = _step6.value; if (it > 1) throw new RangeError("at " + it); } } catch (err) { _iterator6.e(err); } finally { _iterator6.f(); }
  } catch (error) { return error.name + error.message; } finally { log.push("outer"); }
  return "none";
}
function between(list) {
  var _iterator7 = _createForOfIteratorHelper(list), _step7;
  log.push("between");
  var n = 0;
  try { for (_iterator7.s(); !(_step7 = _iterator7.n()).done;) { var it = _step7.value; n += it; } } catch (err) { _iterator7.e(err); } finally { _iterator7.f(); }
  return n;
}
function* steps(list) {
  var _iterator8 = _createForOfIteratorHelper(list), _step8;
  try { for (_iterator8.s(); !(_step8 = _iterator8.n()).done;) { var it = _step8.value; yield it; } } catch (err) { _iterator8.e(err); } finally { _iterator8.f(); }
}
function captured(list) {
  var made = [];
  var _iterator9 = _createForOfIteratorHelper(list), _step9;
  try {
    var _loop = function _loop() { var it = _step9.value; made.push(function () { return it; }); };
    for (_iterator9.s(); !(_step9 = _iterator9.n()).done;) { _loop(); }
  } catch (err) { _iterator9.e(err); } finally { _iterator9.f(); }
  return made.map(function (f) { return f(); }).join();
}
function changes(list) {
  var seen = [];
  var _iterator10 = _createForOfIteratorHelper(list), _step10;
  try { for (_iterator10.s(); !(_step10 = _iterator10.n()).done;) { var it = _step10.value; seen.push(it); if (seen.length < 3) list.push(it * 10); if (seen.length === 4) list.length = 4; list = []; } } catch (err) { _iterator10.e(err); } finally { _iterator10.f(); }
  return seen.join();
}
function repeated(lists) {
  var n = 0;
  for (var k = 0; k < lists.length; k++) {
    var _iterator11 = _createForOfIteratorHelper(lists[k]), _step11;
    try { for (_iterator11.s(); !(_step11 = _iterator11.n()).done;) { var it = _step11.value; n += it; if (n > 1e9) return n; } } catch (err) { _iterator11.e(err); } finally { _iterator11.f(); }
  }
  return n;
}
var closing = function (throws) { return { [Symbol.iterator]: function () { var n = 0; return { next: function () { log.push("next"); if (throws === "next" && n === 1) throw new Error("next"); return { done: n > 2, value: ["a", "stop", "c"][n++] }; }, return: function () { log.push("return"); if (throws === "return") throw new Error("return"); return {}; } }; } }; };
console.log(join(["a", "skip", "b", "stop", "c"]), join([]), join([, 1, , 2]), join(new Set([1, 2, "stop"])), join(new Map([[1, 2]])), join("text"), join(["a", "return"]), join(new Set(["b", "return"])));
for (const list of [["a", "throw"], new Set(["a", "throw"]), closing(), closing("next"), closing("return"), null, undefined, 1, {}, { [Symbol.iterator]: 5 }, { [Symbol.iterator]: function () { return {}; } }]) { try { console.log(join(list)); } catch (error) { console.log(error.name, error.message.slice(0, 50)); } }
console.log(log.join()); log.length = 0;
console.log(nested([[["ab", 2], ["c", 3]], new Map([["key", 4]]), [["next", 1], ["x", 5]], [["end", 1]], [["never", 9]]]), nested([]), nested(new Set([[["x", 1]]])));
console.log(counts([1, 2]), counted, counts(new Set([3])), counted, swallows([1, 2, 3]), swallows(new Set([1, 2])), catches([1, 2]), catches([0]), between([1, 2]), [...steps([1, 2])].join(), captured([1, 2]), changes([1, 2]), log.join());
function* gen(end) { try { yield 1; yield 2; yield 3; } finally { log.push("closed" + end); } }
console.log(join(gen(1)), repeated([[1, 2], new Set([3]), gen(2), [4]]), log.join());
class Reversed extends Array { *[Symbol.iterator]() { for (let k = this.length; k--;) yield this[k]; } }
const own = [1, 2]; own[Symbol.iterator] = function () { return [7, 8][Symbol.iterator](); };
console.log(join(Reversed.from([1, 2, 3])), join(own), join(Object.freeze([1])), join(new Proxy([1, 2], {})));
const getters = [1, 2, 3]; Object.defineProperty(getters, 1, { get() { throw new Error("element"); } });
try { join(getters); } catch (error) { console.log(error.message); }
let total = 0;
for (let k = 0; k < 3000; k++) total += join([k, k + 1, k & 7 ? "x" : "skip"]).length + nested([[["ab", k]]]) + repeated([[k], [k, 1]]);
console.log(total);
