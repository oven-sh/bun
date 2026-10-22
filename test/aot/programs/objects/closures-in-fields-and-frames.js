// Closures kept in fields of short-lived objects and closures passed on to be called by value.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}
globalThis.identity = x => x;

{
  const print = printer("compare-identity");
  function same(x) { return x.m === x.m; }
  function run(i) { const o = { m: () => 7, i }; return same(o); }
  print(run(1), run(2));
}
{
  const print = printer("conversion-in-callee");
  function add(x) { return x + 1; }
  function run(i) { const o = { valueOf: () => 5, i }; return add(o); }
  let s = 0;
  for (let i = 0; i < 100; i++) s += run(i);
  print(s);
}
{
  const print = printer("conversion-in-loop");
  function run(i) { const o = { valueOf: () => i }; return o + 1; }
  let s = 0;
  for (let i = 0; i < 100; i++) s += run(i);
  print(s);
}
{
  const print = printer("keys-in-callee");
  function count(x) { let n = 0; for (const k in x) n++; return n; }
  function run(i) { const o = { m: () => 7, i }; return count(o); }
  print(run(1) + run(2));
}
{
  const print = printer("many-callees");
  function call(x) { return x.m(); }
  function make(i) {
    switch (i % 6) {
    case 0: return { m: () => 1 };
    case 1: return { m: () => 2 };
    case 2: return { m: () => 3 };
    case 3: return { m: () => 4 };
    case 4: return { m: () => 5 };
    default: return { m: () => 6 };
    }
  }
  let s = 0;
  for (let i = 0; i < 60; i++) s += call(make(i));
  print(s);
}
{
  const print = printer("method-captures-this");
  class C { x = 3; m = () => this.x; }
  function use(c) { const f = c.m; return f(); }
  let s = 0;
  for (let i = 0; i < 100; i++) s += use(new C());
  print(s);
}
{
  const print = printer("pure-callee");
  function helper(x) { return x.n; }
  function work(n) { const o = { run: () => {}, n }; o.run(); return helper(o); }
  let s = 0;
  for (let i = 0; i < 100; i++) s += work(i);
  print(s);
}
{
  const print = printer("stringify-in-callee");
  function show(x) { return JSON.stringify(x); }
  function run(i) { const o = { toJSON: () => 3, i }; return show(o); }
  let s = "";
  for (let i = 0; i < 5; i++) s += run(i);
  print(s);
}
{
  const print = printer("to-string-in-callee");
  function show(x) { return `${x}`; }
  function run(i) { const o = { toString: () => "t", i }; return show(o); }
  let s = "";
  for (let i = 0; i < 5; i++) s += run(i);
  print(s);
}
{
  const print = printer("two-callees");
  function call(x) { return x.m(); }
  function run(i) { const o = i & 1 ? { m: () => 1 } : { m: () => 2 }; return call(o); }
  let s = 0;
  for (let i = 0; i < 100; i++) s += run(i);
  print(s);
}
{
  const print = printer("value-read-and-call");
  function use(x) { const f = x.m; return f() + x.i; }
  function run(i) { const o = { m: () => 7, i }; return use(o); }
  let s = 0;
  for (let i = 0; i < 100; i++) s += run(i);
  print(s);
}
{
  const print = printer("value-read-in-callee");
  function use(x) { const f = x.m; return typeof f; }
  function run(i) { const o = { m: () => 7, i }; return use(o); }
  let s = "";
  for (let i = 0; i < 3; i++) s += run(i);
  print(s);
}
{
  const print = printer("captures");
  function apply(f, x) { let r = 0; for (let i = 0; i < 3; i++) r += f(x); return r; }
  function run(k) {
    let s = 0;
    for (let i = 0; i < 50; i++) {
      s += apply(a => a + k, i);
      s += apply(a => a - k, i);
      s += apply(a => a * k, i);
      s += apply(a => a + k + 1, i);
      s += apply(a => a + k + 2, i);
      s += apply(function (a) { return arguments.length + a; }, i);
    }
    return s;
  }
  print(run(2));
}
{
  const print = printer("closure-or-builtin");
  function apply(f, x) { let r = 0; for (let i = 0; i < 3; i++) r += f(x); return r; }
  let s = 0;
  for (let i = 0; i < 100; i++) {
    s += apply(a => a + 1, i);
    s += apply(Math.abs, i);
  }
  print(s);
}
{
  const print = printer("closure-or-unknown");
  function apply(f, x) { let r = 0; for (let i = 0; i < 3; i++) r += f(x); return r; }
  let s = 0;
  for (let i = 0; i < 100; i++) {
    s += apply(a => a + 1, i);
    s += apply(globalThis.identity, i);
  }
  print(s);
}
{
  const print = printer("generator-callee");
  function apply(f, x) { return typeof f(x); }
  let s = "";
  for (let i = 0; i < 3; i++) {
    s += apply(function* (a) { yield a; }, i);
    s += apply(async a => a, i);
    s += apply(a => a, i);
  }
  print(s);
}
{
  const print = printer("many-closures-rest");
  function apply(f, x) { let r = 0; for (let i = 0; i < 3; i++) r += f(x); return r; }
  let s = 0;
  for (let i = 0; i < 100; i++) {
    s += apply(a => a + 1, i);
    s += apply(a => a + 2, i);
    s += apply(a => a + 3, i);
    s += apply(a => a + 4, i);
    s += apply(a => a + 5, i);
    s += apply((...r) => r[0], i);
  }
  print(s);
}
{
  const print = printer("many-closures");
  function apply(f, x) { let r = 0; for (let i = 0; i < 3; i++) r += f(x); return r; }
  let s = 0;
  for (let i = 0; i < 100; i++) {
    s += apply(a => a + 1, i);
    s += apply(a => a + 2, i);
    s += apply(a => a + 3, i);
    s += apply(a => a + 4, i);
    s += apply(a => a + 5, i);
    s += apply(a => a + 6, i);
  }
  print(s);
}

await new Promise(resolve => setTimeout(resolve, 0));
console.log(lines.join("\n"));
