// A function that is called with a known object and with a value from outside is compiled twice. Whichever version a call enters, a method that is only called is still found on the known object.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}
const outside = globalThis.valueFromOutside;

{
  const print = printer("two calls, method");
  const holder = { m() { return 8; } };
  function run(x) { return x.m(); }
  print(run(holder));
  if (outside) print(run(outside));
}
{
  const print = printer("two calls, arrow");
  const holder = { m: () => 8 };
  function run(x) { return x.m(); }
  print(run(holder));
  if (outside) print(run(outside));
}
{
  const print = printer("two calls, arrow-with-field");
  const holder = { m: () => 8, n: 2 };
  function run(x) { return x.m(); }
  print(run(holder));
  if (outside) print(run(outside));
}
{
  const print = printer("two calls, made-in-function");
  function make() { return { m: () => 8, n: 1 }; }
  const holder = make();
  function run(x) { return x.m(); }
  print(run(holder));
  if (outside) print(run(outside));
}
{
  const print = printer("two calls, class-field");
  class C { m = () => 8; }
  const holder = new C();
  function run(x) { return x.m(); }
  print(run(holder));
  if (outside) print(run(outside));
}
{
  const print = printer("two calls, stored-after");
  const holder = { n: 1 };
  holder.m = () => 8;
  function run(x) { return x.m(); }
  print(run(holder));
  if (outside) print(run(outside));
}
{
  const print = printer("one caller, method");
  const holder = { m() { return 8; } };
  function run(x) { return x.m(); }
  function apply(x) { return run(x); }
  print(apply(holder));
  if (outside) print(apply(outside));
}
{
  const print = printer("one caller, arrow");
  const holder = { m: () => 8 };
  function run(x) { return x.m(); }
  function apply(x) { return run(x); }
  print(apply(holder));
  if (outside) print(apply(outside));
}
{
  const print = printer("one caller, arrow-with-field");
  const holder = { m: () => 8, n: 2 };
  function run(x) { return x.m(); }
  function apply(x) { return run(x); }
  print(apply(holder));
  if (outside) print(apply(outside));
}
{
  const print = printer("one caller, made-in-function");
  function make() { return { m: () => 8, n: 1 }; }
  const holder = make();
  function run(x) { return x.m(); }
  function apply(x) { return run(x); }
  print(apply(holder));
  if (outside) print(apply(outside));
}
{
  const print = printer("one caller, class-field");
  class C { m = () => 8; }
  const holder = new C();
  function run(x) { return x.m(); }
  function apply(x) { return run(x); }
  print(apply(holder));
  if (outside) print(apply(outside));
}
{
  const print = printer("one caller, stored-after");
  const holder = { n: 1 };
  holder.m = () => 8;
  function run(x) { return x.m(); }
  function apply(x) { return run(x); }
  print(apply(holder));
  if (outside) print(apply(outside));
}
{
  const print = printer("one site, method");
  const holder = { m() { return 8; } };
  function run(x) { return x.m(); }
  function pick(flag) { return run(flag ? holder : outside); }
  print(pick(true));
  if (outside) print(pick(false));
}
{
  const print = printer("one site, arrow");
  const holder = { m: () => 8 };
  function run(x) { return x.m(); }
  function pick(flag) { return run(flag ? holder : outside); }
  print(pick(true));
  if (outside) print(pick(false));
}
{
  const print = printer("one site, arrow-with-field");
  const holder = { m: () => 8, n: 2 };
  function run(x) { return x.m(); }
  function pick(flag) { return run(flag ? holder : outside); }
  print(pick(true));
  if (outside) print(pick(false));
}
{
  const print = printer("one site, made-in-function");
  function make() { return { m: () => 8, n: 1 }; }
  const holder = make();
  function run(x) { return x.m(); }
  function pick(flag) { return run(flag ? holder : outside); }
  print(pick(true));
  if (outside) print(pick(false));
}
{
  const print = printer("one site, class-field");
  class C { m = () => 8; }
  const holder = new C();
  function run(x) { return x.m(); }
  function pick(flag) { return run(flag ? holder : outside); }
  print(pick(true));
  if (outside) print(pick(false));
}
{
  const print = printer("one site, stored-after");
  const holder = { n: 1 };
  holder.m = () => 8;
  function run(x) { return x.m(); }
  function pick(flag) { return run(flag ? holder : outside); }
  print(pick(true));
  if (outside) print(pick(false));
}
{
  const print = printer("table, method");
  const holder = { m() { return 8; } };
  function a(x) { return x.m() + 0; }
  function b(x) { return x.m() + 1; }
  function c(x) { return x.m() + 2; }
  function d(x) { return x.m() + 3; }
  function e(x) { return x.m() + 4; }
  function f(x) { return x.m() + 5; }
  function g(x) { return x.m() + 6; }
  function h(x) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table, arrow");
  const holder = { m: () => 8 };
  function a(x) { return x.m() + 0; }
  function b(x) { return x.m() + 1; }
  function c(x) { return x.m() + 2; }
  function d(x) { return x.m() + 3; }
  function e(x) { return x.m() + 4; }
  function f(x) { return x.m() + 5; }
  function g(x) { return x.m() + 6; }
  function h(x) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table, arrow-with-field");
  const holder = { m: () => 8, n: 2 };
  function a(x) { return x.m() + 0; }
  function b(x) { return x.m() + 1; }
  function c(x) { return x.m() + 2; }
  function d(x) { return x.m() + 3; }
  function e(x) { return x.m() + 4; }
  function f(x) { return x.m() + 5; }
  function g(x) { return x.m() + 6; }
  function h(x) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table, made-in-function");
  function make() { return { m: () => 8, n: 1 }; }
  const holder = make();
  function a(x) { return x.m() + 0; }
  function b(x) { return x.m() + 1; }
  function c(x) { return x.m() + 2; }
  function d(x) { return x.m() + 3; }
  function e(x) { return x.m() + 4; }
  function f(x) { return x.m() + 5; }
  function g(x) { return x.m() + 6; }
  function h(x) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table, class-field");
  class C { m = () => 8; }
  const holder = new C();
  function a(x) { return x.m() + 0; }
  function b(x) { return x.m() + 1; }
  function c(x) { return x.m() + 2; }
  function d(x) { return x.m() + 3; }
  function e(x) { return x.m() + 4; }
  function f(x) { return x.m() + 5; }
  function g(x) { return x.m() + 6; }
  function h(x) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table, stored-after");
  const holder = { n: 1 };
  holder.m = () => 8;
  function a(x) { return x.m() + 0; }
  function b(x) { return x.m() + 1; }
  function c(x) { return x.m() + 2; }
  function d(x) { return x.m() + 3; }
  function e(x) { return x.m() + 4; }
  function f(x) { return x.m() + 5; }
  function g(x) { return x.m() + 6; }
  function h(x) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with rest parameters, method");
  const holder = { m() { return 8; } };
  function a(x, ...rest) { return x.m() + 0; }
  function b(x, ...rest) { return x.m() + 1; }
  function c(x, ...rest) { return x.m() + 2; }
  function d(x, ...rest) { return x.m() + 3; }
  function e(x, ...rest) { return x.m() + 4; }
  function f(x, ...rest) { return x.m() + 5; }
  function g(x, ...rest) { return x.m() + 6; }
  function h(x, ...rest) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with rest parameters, arrow");
  const holder = { m: () => 8 };
  function a(x, ...rest) { return x.m() + 0; }
  function b(x, ...rest) { return x.m() + 1; }
  function c(x, ...rest) { return x.m() + 2; }
  function d(x, ...rest) { return x.m() + 3; }
  function e(x, ...rest) { return x.m() + 4; }
  function f(x, ...rest) { return x.m() + 5; }
  function g(x, ...rest) { return x.m() + 6; }
  function h(x, ...rest) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with rest parameters, arrow-with-field");
  const holder = { m: () => 8, n: 2 };
  function a(x, ...rest) { return x.m() + 0; }
  function b(x, ...rest) { return x.m() + 1; }
  function c(x, ...rest) { return x.m() + 2; }
  function d(x, ...rest) { return x.m() + 3; }
  function e(x, ...rest) { return x.m() + 4; }
  function f(x, ...rest) { return x.m() + 5; }
  function g(x, ...rest) { return x.m() + 6; }
  function h(x, ...rest) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with rest parameters, made-in-function");
  function make() { return { m: () => 8, n: 1 }; }
  const holder = make();
  function a(x, ...rest) { return x.m() + 0; }
  function b(x, ...rest) { return x.m() + 1; }
  function c(x, ...rest) { return x.m() + 2; }
  function d(x, ...rest) { return x.m() + 3; }
  function e(x, ...rest) { return x.m() + 4; }
  function f(x, ...rest) { return x.m() + 5; }
  function g(x, ...rest) { return x.m() + 6; }
  function h(x, ...rest) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with rest parameters, class-field");
  class C { m = () => 8; }
  const holder = new C();
  function a(x, ...rest) { return x.m() + 0; }
  function b(x, ...rest) { return x.m() + 1; }
  function c(x, ...rest) { return x.m() + 2; }
  function d(x, ...rest) { return x.m() + 3; }
  function e(x, ...rest) { return x.m() + 4; }
  function f(x, ...rest) { return x.m() + 5; }
  function g(x, ...rest) { return x.m() + 6; }
  function h(x, ...rest) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with rest parameters, stored-after");
  const holder = { n: 1 };
  holder.m = () => 8;
  function a(x, ...rest) { return x.m() + 0; }
  function b(x, ...rest) { return x.m() + 1; }
  function c(x, ...rest) { return x.m() + 2; }
  function d(x, ...rest) { return x.m() + 3; }
  function e(x, ...rest) { return x.m() + 4; }
  function f(x, ...rest) { return x.m() + 5; }
  function g(x, ...rest) { return x.m() + 6; }
  function h(x, ...rest) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with default parameters, method");
  const holder = { m() { return 8; } };
  function a(x, y = 1) { return x.m() + 0; }
  function b(x, y = 1) { return x.m() + 1; }
  function c(x, y = 1) { return x.m() + 2; }
  function d(x, y = 1) { return x.m() + 3; }
  function e(x, y = 1) { return x.m() + 4; }
  function f(x, y = 1) { return x.m() + 5; }
  function g(x, y = 1) { return x.m() + 6; }
  function h(x, y = 1) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with default parameters, arrow");
  const holder = { m: () => 8 };
  function a(x, y = 1) { return x.m() + 0; }
  function b(x, y = 1) { return x.m() + 1; }
  function c(x, y = 1) { return x.m() + 2; }
  function d(x, y = 1) { return x.m() + 3; }
  function e(x, y = 1) { return x.m() + 4; }
  function f(x, y = 1) { return x.m() + 5; }
  function g(x, y = 1) { return x.m() + 6; }
  function h(x, y = 1) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with default parameters, arrow-with-field");
  const holder = { m: () => 8, n: 2 };
  function a(x, y = 1) { return x.m() + 0; }
  function b(x, y = 1) { return x.m() + 1; }
  function c(x, y = 1) { return x.m() + 2; }
  function d(x, y = 1) { return x.m() + 3; }
  function e(x, y = 1) { return x.m() + 4; }
  function f(x, y = 1) { return x.m() + 5; }
  function g(x, y = 1) { return x.m() + 6; }
  function h(x, y = 1) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with default parameters, made-in-function");
  function make() { return { m: () => 8, n: 1 }; }
  const holder = make();
  function a(x, y = 1) { return x.m() + 0; }
  function b(x, y = 1) { return x.m() + 1; }
  function c(x, y = 1) { return x.m() + 2; }
  function d(x, y = 1) { return x.m() + 3; }
  function e(x, y = 1) { return x.m() + 4; }
  function f(x, y = 1) { return x.m() + 5; }
  function g(x, y = 1) { return x.m() + 6; }
  function h(x, y = 1) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with default parameters, class-field");
  class C { m = () => 8; }
  const holder = new C();
  function a(x, y = 1) { return x.m() + 0; }
  function b(x, y = 1) { return x.m() + 1; }
  function c(x, y = 1) { return x.m() + 2; }
  function d(x, y = 1) { return x.m() + 3; }
  function e(x, y = 1) { return x.m() + 4; }
  function f(x, y = 1) { return x.m() + 5; }
  function g(x, y = 1) { return x.m() + 6; }
  function h(x, y = 1) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("table with default parameters, stored-after");
  const holder = { n: 1 };
  holder.m = () => 8;
  function a(x, y = 1) { return x.m() + 0; }
  function b(x, y = 1) { return x.m() + 1; }
  function c(x, y = 1) { return x.m() + 2; }
  function d(x, y = 1) { return x.m() + 3; }
  function e(x, y = 1) { return x.m() + 4; }
  function f(x, y = 1) { return x.m() + 5; }
  function g(x, y = 1) { return x.m() + 6; }
  function h(x, y = 1) { return x.m() + 7; }
  const table = [a, b, c, d, e, f, g, h];
  let sum = 0;
  for (let i = 0; i < table.length; i++) sum += table[i](holder);
  print(sum);
  if (outside) for (let i = 0; i < table.length; i++) print(table[i](outside));
}
{
  const print = printer("callback, method");
  const holder = { m() { return 8; } };
  function run(x) { return x.m(); }
  print([holder].map(run).join());
  if (outside) print([outside].map(run).join());
}
{
  const print = printer("callback, arrow");
  const holder = { m: () => 8 };
  function run(x) { return x.m(); }
  print([holder].map(run).join());
  if (outside) print([outside].map(run).join());
}
{
  const print = printer("callback, arrow-with-field");
  const holder = { m: () => 8, n: 2 };
  function run(x) { return x.m(); }
  print([holder].map(run).join());
  if (outside) print([outside].map(run).join());
}
{
  const print = printer("callback, made-in-function");
  function make() { return { m: () => 8, n: 1 }; }
  const holder = make();
  function run(x) { return x.m(); }
  print([holder].map(run).join());
  if (outside) print([outside].map(run).join());
}
{
  const print = printer("callback, class-field");
  class C { m = () => 8; }
  const holder = new C();
  function run(x) { return x.m(); }
  print([holder].map(run).join());
  if (outside) print([outside].map(run).join());
}
{
  const print = printer("callback, stored-after");
  const holder = { n: 1 };
  holder.m = () => 8;
  function run(x) { return x.m(); }
  print([holder].map(run).join());
  if (outside) print([outside].map(run).join());
}
{
  const print = printer("call and apply, method");
  const holder = { m() { return 8; } };
  function run(x) { return x.m(); }
  print(run.call(null, holder), run.apply(null, [holder]));
  if (outside) print(run(outside));
}
{
  const print = printer("call and apply, arrow");
  const holder = { m: () => 8 };
  function run(x) { return x.m(); }
  print(run.call(null, holder), run.apply(null, [holder]));
  if (outside) print(run(outside));
}
{
  const print = printer("call and apply, arrow-with-field");
  const holder = { m: () => 8, n: 2 };
  function run(x) { return x.m(); }
  print(run.call(null, holder), run.apply(null, [holder]));
  if (outside) print(run(outside));
}
{
  const print = printer("call and apply, made-in-function");
  function make() { return { m: () => 8, n: 1 }; }
  const holder = make();
  function run(x) { return x.m(); }
  print(run.call(null, holder), run.apply(null, [holder]));
  if (outside) print(run(outside));
}
{
  const print = printer("call and apply, class-field");
  class C { m = () => 8; }
  const holder = new C();
  function run(x) { return x.m(); }
  print(run.call(null, holder), run.apply(null, [holder]));
  if (outside) print(run(outside));
}
{
  const print = printer("call and apply, stored-after");
  const holder = { n: 1 };
  holder.m = () => 8;
  function run(x) { return x.m(); }
  print(run.call(null, holder), run.apply(null, [holder]));
  if (outside) print(run(outside));
}
{
  const print = printer("bound, method");
  const holder = { m() { return 8; } };
  function run(x) { return x.m(); }
  const bound = run.bind(null, holder);
  print(bound());
  if (outside) print(run(outside));
}
{
  const print = printer("bound, arrow");
  const holder = { m: () => 8 };
  function run(x) { return x.m(); }
  const bound = run.bind(null, holder);
  print(bound());
  if (outside) print(run(outside));
}
{
  const print = printer("bound, arrow-with-field");
  const holder = { m: () => 8, n: 2 };
  function run(x) { return x.m(); }
  const bound = run.bind(null, holder);
  print(bound());
  if (outside) print(run(outside));
}
{
  const print = printer("bound, made-in-function");
  function make() { return { m: () => 8, n: 1 }; }
  const holder = make();
  function run(x) { return x.m(); }
  const bound = run.bind(null, holder);
  print(bound());
  if (outside) print(run(outside));
}
{
  const print = printer("bound, class-field");
  class C { m = () => 8; }
  const holder = new C();
  function run(x) { return x.m(); }
  const bound = run.bind(null, holder);
  print(bound());
  if (outside) print(run(outside));
}
{
  const print = printer("bound, stored-after");
  const holder = { n: 1 };
  holder.m = () => 8;
  function run(x) { return x.m(); }
  const bound = run.bind(null, holder);
  print(bound());
  if (outside) print(run(outside));
}

console.log(lines.join("\n"));
