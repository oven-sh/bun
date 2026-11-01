// A generator that is suspended inside a destructuring pattern or a `for..of` head and then resumed with `return()` or `throw()` closes the open iterators, innermost first.
var log = [];
function it(name, values, kind) {
  var i = 0;
  var iterator = { next() { log.push(name + ".next"); return i < values.length ? { value: values[i++], done: false } : { value: undefined, done: true }; } };
  if (kind === "throws") iterator.return = function () { log.push(name + ".return!"); throw new Error("from " + name); };
  else if (kind === "no object") iterator.return = function () { log.push(name + ".return#"); return 1; };
  else if (kind === "null") iterator.return = null;
  else if (kind === "getter") Object.defineProperty(iterator, "return", { get() { log.push(name + ".get return"); return function () { log.push(name + ".return"); return {}; }; } });
  else if (kind !== "none") iterator.return = function (v) { log.push(name + ".return(" + arguments.length + ")"); return {}; };
  return { [Symbol.iterator]() { log.push(name + ".open"); return iterator; } };
}
var U = undefined, K = "plain";
var makers = {
  "a target": function* () { [ {}[yield 1] ] = it("a", [1, 2], K); log.push("behind"); },
  "the second target": function* () { var x; [ x, {}[yield 1] ] = it("a", [1, 2, 3], K); log.push("behind " + x); },
  "two targets": function* () { [ {}[yield 1], {}[yield 2] ] = it("a", [1, 2, 3], K); log.push("behind"); },
  "an initializer": function* () { var x; [ x = yield 1 ] = it("a", [U, 2], K); log.push("behind " + x); },
  "an initializer, exhausted": function* () { var x; [ x = yield 1 ] = it("a", [], K); log.push("behind " + x); },
  "exhausted by the first": function* () { var x, y; [ x, y = yield 1 ] = it("a", [1], K); log.push("behind " + x + y); },
  "a rest target": function* () { [ ...{}[yield 1] ] = it("a", [1, 2], K); log.push("behind"); },
  "a nested pattern": function* () { var y; [ [ y = yield 1 ] ] = it("o", [it("i", [U, 2], K), 5], K); log.push("behind " + y); },
  "three deep": function* () { var y; [ [ [ y = yield 1 ] ] ] = it("o", [it("m", [it("i", [U], K)], K)], K); log.push("behind " + y); },
  "an object pattern in it": function* () { var p; [ { p = yield 1 } ] = it("a", [{}, 2], K); log.push("behind " + p); },
  "in an object pattern": function* () { var r; ({ q: [ r = yield 1 ] } = { q: it("a", [U, 2], K) }); log.push("behind " + r); },
  "a computed key": function* () { var r; [ { [yield 1]: r } ] = it("a", [{ k: 7 }, 2], K); log.push("behind " + r); },
  "const": function* () { const [ c = yield 1 ] = it("a", [U, 2], K); log.push("behind " + c); },
  "let, the second": function* () { let [ b, c = yield 1 ] = it("a", [1, U, 3], K); log.push("behind " + b + c); },
  "var, nested": function* () { var [ [ c = yield 1 ] ] = it("o", [it("i", [U], K)], K); log.push("behind " + c); },
  "a head: a target": function* () { for ([ {}[yield 1] ] of it("loop", [it("s", [1, 2], K), it("t", [3], K)], K)) log.push("body"); log.push("behind"); },
  "a head: var": function* () { for (var [ a = yield 1 ] of it("loop", [it("s", [U], K)], K)) log.push("body " + a); log.push("behind"); },
  "a head: const": function* () { for (const [ a = yield 1 ] of it("loop", [it("s", [U], K), it("t", [U], K)], K)) log.push("body " + a); log.push("behind"); },
  "a head: no pattern": function* () { for ({}[yield 1] of it("loop", [1, 2], K)) log.push("body"); log.push("behind"); },
  "a head: an object pattern": function* () { for (const { k = yield 1 } of it("loop", [{}, {}], K)) log.push("body " + k); log.push("behind"); },
  "a head in a loop": function* () { for (const u of it("outer", [1, 2], K)) for ([ {}[yield u] ] of it("inner", [it("s", [1], K)], K)) log.push("body"); log.push("behind"); },
  "a pattern in a body": function* () { for (const u of it("loop", [1, 2], K)) { [ {}[yield u] ] = it("a", [1, 2], K); log.push("body"); } log.push("behind"); },
  "in try finally": function* () { try { [ {}[yield 1] ] = it("a", [1, 2], K); } finally { log.push("finally"); } log.push("behind"); },
  "finally that yields": function* () { try { [ {}[yield 1] ] = it("a", [1, 2], K); } finally { log.push("finally"); yield "f"; log.push("finally 2"); } log.push("behind"); },
  "finally inside a loop": function* () { for (const u of it("loop", [1, 2], K)) { try { [ {}[yield u] ] = it("a", [1], K); } finally { log.push("finally " + u); } } log.push("behind"); },
  "in try catch": function* () { try { [ {}[yield 1] ] = it("a", [1, 2], K); } catch (e) { log.push("caught " + e.message); } log.push("behind"); },
  "a catch parameter": function* () { try { throw it("a", [U, 2], K); } catch ([ e = yield 1 ]) { log.push("caught " + e); } log.push("behind"); },
  "yield* in a target": function* () { function* inner() { try { yield "i1"; yield "i2"; } finally { log.push("inner finally"); } } [ {}[yield* inner()] ] = it("a", [1, 2], K); log.push("behind"); },
  "an argument": function* () { log.push("got " + typeof ((x) => x)([ {}[yield 1] ] = it("a", [1, 2], K))); },
  "a labelled break behind it": function* () { out: for (const u of it("loop", [1, 2], K)) { [ {}[yield u] ] = it("a", [1, 2], K); break out; } log.push("behind"); },
  "a return behind it": function* () { for (const u of it("loop", [1, 2], K)) { [ {}[yield u] ] = it("a", [1, 2], K); return "returned"; } },
  "a yield that is no part of a pattern": function* () { for (const u of it("loop", [1, 2], K)) { yield u; } log.push("behind"); },
};
function step(g, how, n) { try { var r = how === "return" ? g.return("R") : how === "throw" ? g.throw(new Error("T")) : g.next("N" + n); return String(r.value) + (r.done ? "." : ","); } catch (e) { return "threw " + e.message + ";"; } }
for (var kind of ["plain", "throws", "no object", "null", "none", "getter"]) {
  for (var name in makers) {
    if (kind !== "plain" && !/^(a target|an initializer|a nested pattern|a head: a target|a head: var|a head in a loop|in try finally|finally that yields|a rest target)$/.test(name)) continue;
    for (var how of ["return", "throw", "next"]) for (var at = 1; at <= 3; at++) {
      K = kind; log = []; var g = makers[name](), s = "";
      for (var n = 0; n < at; n++) s += step(g, "next", n);
      s += "[" + step(g, how, at) + "]" + step(g, "next", 9) + step(g, "next", 10);
      console.log(kind + " | " + name + " | " + how + "@" + at + ": " + s + " | " + log.join(" "));
    }
  }
}
async function asyncRows() {
  var amakers = {
    "async: a target": async function* () { [ {}[yield 1] ] = it("a", [1, 2], K); log.push("behind"); },
    "async: an await in a target": async function* () { [ {}[await 1] ] = it("a", [1, 2], K); yield 1; log.push("behind"); },
    "async: a head": async function* () { for ([ {}[yield 1] ] of it("loop", [it("s", [1], K)], K)) log.push("body"); log.push("behind"); },
    "async: a nested pattern": async function* () { var y; [ [ y = yield 1 ] ] = it("o", [it("i", [U], K)], K); log.push("behind " + y); },
  };
  for (var kind of ["plain", "throws"]) for (var name in amakers) for (var how of ["return", "throw", "next"]) {
    K = kind; log = []; var g = amakers[name](), s = "";
    try { s += JSON.stringify(await g.next()); } catch (e) { s += "threw " + e.message; }
    try { s += JSON.stringify(await (how === "return" ? g.return("R") : how === "throw" ? g.throw(new Error("T")) : g.next("N"))); } catch (e) { s += "threw " + e.message; }
    try { s += JSON.stringify(await g.next()); } catch (e) { s += "threw " + e.message; }
    console.log(kind + " | " + name + " | " + how + ": " + s + " | " + log.join(" "));
  }
}
asyncRows();
