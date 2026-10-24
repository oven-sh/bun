// A store in a generator or an async function that is called once has not run when the call returns.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
var box;
(function* () { box = { a: 1 }; })();
console.log(attempt(() => box.a));
function inner() {
  var v;
  (function* () { v = { a: 1 }; })();
  return attempt(() => v.a);
}
console.log(inner());
function inner2() {
  var v;
  (async function () { await 0; v = { a: 1 }; })();
  return attempt(() => v.a);
}
console.log(inner2());
