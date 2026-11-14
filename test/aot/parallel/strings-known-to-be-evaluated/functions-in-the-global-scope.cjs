// Functions out of constant strings by Function: they see the global scope alone.
const say = (...a) => console.log(...a.map(x => typeof x === "function" ? x.toString() : x));
const attempt = f => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
var fileVariable = 1; let fileLet = 2; const helper = 3;
const ops = { add: "+", sub: "-", mul: "*" }, made = {};
for (const name in ops) made[name] = new Function("a", "b", "return a " + ops[name] + " b;");
say(made.add(1, 2), made.sub(1, 2), made.mul(3, 4), made.add, made.add.name, made.add.length, made.add === made.sub);
const again = []; for (let i = 0; i < 2; i++) again.push(Function("x", "return x + 1;")); say(again[0] === again[1], again[0](1), again[1]);
say(attempt(() => Function("x", "return typeof fileVariable + typeof fileLet + typeof helper + typeof say + x;")(1)));
say(attempt(() => Function("x", "return fileLet + x;")(1)));
globalThis.shared = 5; say(Function("x", "return shared + x;")(1)); globalThis.shared = 6; say(Function("x", "shared = x; return shared;")(9), shared);
say(Function("x", "return this === globalThis;")(1), Function("x", "'use strict'; return this;")(1), Function("x", "return typeof this;").call(4));
say(Function("x", "var helper = x; function fileLet() { return helper; } return fileLet();")(7), helper, fileLet);
say(Function("helper", "return helper * 2;")(4), Function("helper, fileLet", "return [helper, fileLet].join();")(4, 5), Function(" a ", "b , c", "return a + b + c;")(1, 2, 3));
say(Function("x", "return typeof anonymous;")(1), Function("x", "return arguments.length + Function.length;")(1, 2), attempt(() => Function("x", "return new.target;")(1)));
const Point = new Function("x", "y", "this.x = x; this.y = y;"); Point.prototype.sum = new Function("k", "return this.x + this.y + k;"); say(new Point(1, 2).sum(3), new Point(1, 2) instanceof Point, JSON.stringify(new Point(5, 6)));
for (const bad of [["a b", "return 1;"], ["a", "return 1"], ["a", "} , function () {"], ["a", "return 1; }) ; (function () {"], ["a", "/*"], ["a", "*/"], ["a", "// end"], ["a = 1", "return a;"], ["{ a }", "return a;"], ["...a", "return a.length;"], ["a,", "return a;"], ["a, a", "return a;"], ["a", "'use strict'; with (a) {}"], ["a", "let a;"], ["a", "break;"], ["a", "return await;"], ["a", "yield: 1; return 2;"], ["a", "super.x"], ["a", "return 010;"], ["1", "return 1;"], ["a/**/", "return a;"], ["a\n", "return a;"], ["a", "\n\nthrow new Error('line');"]])
  say(JSON.stringify(bad), attempt(() => { const f = new Function(bad[0], bad[1]); return f.length + f.toString(); }), attempt(() => Function(bad[0], bad[1])([1, 2])));
try { Function("a", "\n\n  throw new Error('line ' + a);")(1); } catch (e) { say(e.stack.split("\n").slice(0, 2).join("|").replace(/\(.*\/(b01)/, "($1")); }
try { new Function("a", "return a.b.c;")({}); } catch (e) { say(e.message); }
{ const real = Function; let n = 0; globalThis.Function = function (...a) { n++; return real(...a); }; const f = new Function("x", "return x + 2;"); globalThis.Function = real; say(f(1), n, new Function("x", "return x + 2;")(1), n); }
const unknown = process.argv.length > 50 ? "x" : "y"; say(Function(unknown, "return " + unknown + ";")(3), Function(unknown, "return x;").toString());
const list = ["a", "b", "c"]; say(Function(list.join(), "return [" + list.map(n => n + " + 1").join(", ") + "].join();")(1, 2, 3));
function maker(Type) { return new Function("value", "holder", "\n 'use strict';\n holder.pIndex = value;\n return holder;\n".replace(/Index/g, Type)); }
const makers = []; for (var i = 0; i < 4; ++i) makers.push(maker(i + 1)); say(JSON.stringify(makers[0](5, {})), JSON.stringify(makers[3](6, {})), makers[1]);
function code(total) { var props = new Array(total); for (var i = 0; i < props.length; ++i) props[i] = "this.p" + (i + 1); return new Function("tryCatch", "go", "return function Holder() { " + props.join(" = ") + " = null; this.total = " + total + "; };")(1, 2); }
const H = code(3); say(Object.keys(new H()).join(), H, H.name);
let sum = 0; const inner = Function("n", "let s = 0; for (let i = 0; i < n; i++) s += i * i; return s;"); for (let k = 0; k < 50; k++) sum += inner(100); say(sum);
say(Function("a", "b", "return function (c) { return a + b + c + outer2(); function outer2() { return 100; } };")(1, 2)(3));
class Strict { m() { return Function("x", "return typeof this + x;"); } n() { return Function("x", "'use strict'; return typeof this + x;"); } static p = Function("x", "strictLeak = x; return typeof strictLeak;"); }
say(new Strict().m()(1), new Strict().n()(1), Strict.p(3), globalThis.strictLeak); delete globalThis.strictLeak;
say((function () { "use strict"; return Function("x", "return typeof this + x;"); })()(1));
