// Functions that begin nearly as Babel's helpers do: an array is stepped through as they say.
let calls = 0;
function byWindow(r) { var m = typeof window !== "undefined" && r[Symbol.iterator] || r["@@iterator"]; if (m) return (m = m.call(r)).next.bind(m); var i = 0; return function () { return i >= r.length ? { done: true } : { done: false, value: "own " + r[i++] }; }; }
function withDefault(r, extra = calls++) { var m = typeof Symbol !== "undefined" && r[Symbol.iterator] || r["@@iterator"]; if (m) return (m = m.call(r)).next.bind(m); throw new TypeError("no"); }
function withPattern(r, { length } = { get length() { calls += 10; return 1; } }) { var m = typeof Symbol !== "undefined" && r[Symbol.iterator] || r["@@iterator"]; if (m) return (m = m.call(r)).next.bind(m); throw new TypeError("no"); }
function plain(r, allowed) { var m = typeof Symbol !== "undefined" && r[Symbol.iterator] || r["@@iterator"]; if (m) return (m = m.call(r)).next.bind(m); throw new TypeError("no"); }
function closing(r) { var t = typeof window != "undefined" && r[Symbol.iterator] || r["@@iterator"]; if (!t) { var n = 0, F = function () {}; return { s: F, n: function () { return n >= r.length ? { done: true } : { done: false, value: "own " + r[n++] }; }, e: function (e) { throw e; }, f: F }; } var o, a = true, u = false; return { s: function () { t = t.call(r); }, n: function () { var e = t.next(); a = e.done; return e; }, e: function (e) { u = true; o = e; }, f: function () { try { if (!a && t.return != null) t.return(); } finally { if (u) throw o; } } }; }
function first(list) { var out = []; for (var it = byWindow(list), step; !(step = it()).done;) { var v = step.value; out.push(v); } return out; }
function second(list) { var out = []; for (var it = withDefault(list), step; !(step = it()).done;) { var v = step.value; out.push(v); } return out; }
function third(list) { var out = []; for (var it = withPattern(list), step; !(step = it()).done;) { var v = step.value; out.push(v); } return out; }
function fourth(list) { var out = []; for (var it = plain(list, true), step; !(step = it()).done;) { var v = step.value; out.push(v); } return out; }
function fifth(list) { var out = []; var it = closing(list), step; try { for (it.s(); !(step = it.n()).done;) { var v = step.value; out.push(v); } } catch (e) { it.e(e); } finally { it.f(); } return out; }
console.log(first([1, 2]).join(), second([1, 2]).join(), calls, third([1, 2]).join(), calls, fourth([1, 2]).join(), fifth([1, 2]).join());
