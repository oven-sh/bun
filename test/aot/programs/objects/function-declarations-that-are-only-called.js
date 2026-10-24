// A function declaration that is only called has no closure, whatever the form of the function and of the call.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("call-apply");
  function f(a) { return a + 1; }
  print(f.apply(null, [1]));
}
{
  const print = printer("call-in-function");
  function f() { return 1; }
  function g() { return f() + f(); }
  print(g());
}
{
  const print = printer("call-recursive");
  function f(n) { return n ? n + f(n - 1) : 0; }
  print(f(10));
}
{
  const print = printer("call");
  function f() { return 1; }
  print(f());
}
{
  const print = printer("called-by-conversion");
  function five() { return 5; }
  const o = { valueOf() { return five(); } };
  print(o + 1);
}
{
  const print = printer("captured-by-conversion");
  let n = 5;
  const o = { valueOf() { return n; } };
  print(o + 1);
  n = 6;
  print(o + 1);
}
{
  const print = printer("const-arrow");
  const f = () => 1;
  print(f());
}
{
  const print = printer("default-parameter");
  function d() { return 2; }
  function f(a = d()) { return a; }
  print(f());
}
{
  const print = printer("function-as-conversion");
  function five() { return 5; }
  const o = { valueOf: five };
  print(o + 1);
}
{
  const print = printer("function-as-method");
  function five() { return 5; }
  const o = { m: five };
  print(o.m());
}
{
  const print = printer("function-name-length");
  function f(a, b) { return 1; }
  print(f.name, f.length, f());
}
{
  const print = printer("function-property");
  function f() { return f.count; }
  f.count = 3;
  print(f());
}
{
  const print = printer("function-reassigned");
  function f() { return 1; }
  print(f());
  f = function () { return 2; };
  print(f());
}
{
  const print = printer("function-to-string");
  function f() { return 1; }
  f.toString = function () { return "text"; };
  print(`${f}`, f());
}
{
  const print = printer("function-value-of");
  function f() { return 1; }
  f.valueOf = function () { return 3; };
  print(f + 1, f());
}
{
  const print = printer("getter-calls");
  function d() { return 2; }
  const o = { get x() { return d(); } };
  print(o.x);
}
{
  const print = printer("instanceof");
  function F() {}
  print(new F() instanceof F, ({}) instanceof F);
}
{
  const print = printer("let-reassigned");
  let f = () => 1;
  print(f());
  f = () => 2;
  print(f());
}
{
  const print = printer("new");
  function F() { this.x = 1; }
  print(new F().x);
}
{
  const print = printer("proxy-target");
  function f() { return 5; }
  print(new Proxy(f, {})());
}
{
  const print = printer("tagged-template");
  function tag(strings, value) { return strings[0] + value; }
  print(tag`a${1}`);
}
{
  const print = printer("then-callback");
  function f(x) { print("called", x); }
  async function g() { return 4; }
  g().then(f);
}
{
  const print = printer("typeof");
  function f() { return 1; }
  print(typeof f, f());
}
{
  const print = printer("unused-store");
  let unused = 1;
  unused = 2;
  print("done");
}
{
  const print = printer("arguments");
  function f() { return arguments.length; }
  print(f(1, 2));
}
{
  const print = printer("async-await");
  async function f() { return 1; }
  async function main() { print(await f()); }
  main();
}
{
  const print = printer("async");
  async function f() { return 1; }
  f().then(print);
}
{
  const print = printer("big-function");
  function f(a) {
    let s = 0;
    for (let i = 0; i < a; i++) { for (let j = 0; j < a; j++) { s += i * j; if (s > 1000) s -= 1000; } }
    for (let i = 0; i < a; i++) { for (let j = 0; j < a; j++) { s += i + j; if (s > 1000) s -= 1000; } }
    return s;
  }
  print(f(10), f(20), f(30));
}
{
  const print = printer("block-declaration");
  { function f() { return 1; } print(f()); }
}
{
  const print = printer("called-before-declaration");
  print(f());
  function f() { return 1; }
}
{
  const print = printer("called-from-callback");
  function f(x) { return x + 1; }
  async function g() { return 1; }
  g().then(x => print(f(x)));
}
{
  const print = printer("called-from-closure");
  function f() { return 1; }
  const g = () => f();
  print(g());
}
{
  const print = printer("called-from-method");
  function f() { return 1; }
  class C { m() { return f(); } }
  print(new C().m());
}
{
  const print = printer("callee-name-in-error");
  function f() { return new Error("x").stack.length > 0; }
  print(f());
}
{
  const print = printer("class-declaration");
  class C { constructor() { this.x = 1; } }
  print(new C().x);
}
{
  const print = printer("class-extends");
  class B { constructor() { this.x = 1; } }
  class C extends B {}
  print(new C().x);
}
{
  const print = printer("comma-callee");
  function f() { return 1; }
  print((0, f)());
}
{
  const print = printer("conditional-callee");
  function a() { return 1; }
  function b() { return 2; }
  function pick(c) { return (c ? a : b)(); }
  print(pick(true), pick(false));
}
{
  const print = printer("construct-and-call");
  function F() { if (new.target) this.x = 1; return undefined; }
  print(new F().x, F());
}
{
  const print = printer("construct");
  function F() { this.x = 1; }
  print(new F().x);
}
{
  const print = printer("default");
  function f(a = 3) { return a; }
  print(f());
}
{
  const print = printer("destructured-parameter");
  function f({ a }, [b]) { return a + b; }
  print(f({ a: 1 }, [2]));
}
{
  const print = printer("eval-in-callee");
  function f() { return eval("1 + 1"); }
  print(f());
}
{
  const print = printer("generator");
  function* g() { yield 1; }
  const it = g();
  print(typeof it);
}
{
  const print = printer("getter-callee");
  function f() { return 1; }
  const o = { get g() { return f; } };
  print(o.g());
}
{
  const print = printer("in-try");
  function f() { throw new Error("x"); }
  try { f(); } catch (e) { print(e.message); }
}
{
  const print = printer("mutual-recursion");
  function even(n) { return n === 0 ? true : odd(n - 1); }
  function odd(n) { return n === 0 ? false : even(n - 1); }
  print(even(10));
}
{
  const print = printer("nested-captures");
  function outer(a) { function inner() { return a; } return inner(); }
  print(outer(4));
}
{
  const print = printer("nested-declaration");
  function outer() { function inner() { return 1; } return inner(); }
  print(outer());
}
{
  const print = printer("optional-call");
  function f() { return 1; }
  print(f?.());
}
{
  const print = printer("rest");
  function f(...list) { return list.length; }
  print(f(1, 2));
}
{
  const print = printer("spread-call");
  function f(a, b) { return a + b; }
  const list = [1, 2];
  print(f(...list));
}
{
  const print = printer("tail");
  function f(n) { return n; }
  function g(n) { return f(n); }
  print(g(2));
}
{
  const print = printer("this-sloppy");
  function f() { return this === undefined; }
  print(f());
}
{
  const print = printer("too-few-arguments");
  function f(a, b, c) { return c; }
  print(f(1));
}
{
  const print = printer("too-many-arguments");
  function f(a) { return a; }
  print(f(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20));
}
{
  const print = printer("with-label-loop");
  function f(i) { return i * 2; }
  let s = 0;
  for (let i = 0; i < 1000; i++) s += f(i);
  print(s);
}

await new Promise(resolve => setTimeout(resolve, 0));
console.log(lines.join("\n"));
