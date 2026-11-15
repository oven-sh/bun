const say = (...a) => console.log(...a.map(x => typeof x === "function" ? x.toString() : x));
function f(code) { eval(code); return new Function("x", "return typeof hidden + typeof local + x;"); }
say(f("var hidden = 1; var local = 2;")(1));
function g(o) { with (o) { return Function("x", "return typeof inside + x;"); } } say(g({ inside: 1 })(2));
function h(local) { return [eval("(function (x) { return local + x; })"), Function("x", "return typeof local + x;")].map(f => f(1)); } say(h(5).join());
var value = 1; say(Function("x", "return typeof value + x;")(1)); globalThis.value = "global"; say(Function("x", "return value + x;")(1)); delete globalThis.value;
