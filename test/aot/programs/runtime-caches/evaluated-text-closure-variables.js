// Functions made from text at run time that read the variables of the functions around them: parameters, var, let, const, functions, classes, at several depths,
// before they are initialized, after they have changed, as callees, behind `with` and behind a sloppy eval. Each case runs several times: the first run links, the later ones take the short way.
const lines = [];
function show(name, run) {
  const seen = [];
  for (let turn = 0; turn < 4; turn++) {
    try {
      seen.push(JSON.stringify(run(turn)) ?? "undefined");
    } catch (error) {
      seen.push(error.constructor.name);
    }
  }
  lines.push(name + ": " + seen.join(" | "));
}
const make = (parameters, text) => new Function(...parameters, text);

show("a parameter of the outer function", (() => {
  const inner = make(["a", "b"], "return function (x) { return a + b + x; };")(1, 2);
  return turn => inner(turn);
})());

show("const, let, var, function and class", (() => {
  const inner = make([], `
    const c = 10; let l = 20; var v = 30; function f() { return 40; } class K { static s = 50; }
    return function (x) { return [c, l, v, f(), K.s, x]; };`)();
  return turn => inner(turn);
})());

show("three functions deep", (() => {
  const inner = make(["a"], `
    const b = a + 1;
    return function (c) { const d = c + 1; return function (e) { const f = e + 1; return function (g) { return [a, b, c, d, e, f, g]; }; }; };`)(1)(10)(100);
  return turn => inner(turn);
})());

show("a block scope between", (() => {
  const inner = make(["a"], `
    const list = [];
    for (let i = 0; i < 3; i++) { const twice = i * 2; list.push(function (x) { return [a, i, twice, x]; }); }
    return list;`)(7);
  return turn => inner.map(f => f(turn));
})());

show("read before the declaration has run", (() => {
  const outer = make([], `
    const early = function () { return late; };
    let result;
    try { result = early(); } catch (error) { result = error.constructor.name; }
    const late = 5;
    return [result, early];`);
  return () => { const [first, early] = outer(); return [first, early(), early()]; };
})());

show("read before the declaration has run, the same function before and after", (() => {
  const outer = make(["when"], `
    function read() { return value; }
    const seen = [];
    for (let i = 0; i < 3; i++) { try { seen.push(read()); } catch (error) { seen.push(error.constructor.name); } }
    let value = when;
    for (let i = 0; i < 3; i++) seen.push(read());
    return seen;`);
  return turn => outer(turn);
})());

show("typeof of a variable before its declaration has run", (() => {
  const outer = make([], `
    const early = function () { return typeof late; };
    let result;
    try { result = early(); } catch (error) { result = error.constructor.name; }
    let late = 5;
    return [result, early()];`);
  return () => outer();
})());

show("a class that names itself in a static initializer", (() => {
  const outer = make([], `
    try { class K { static s = (() => K)(); static t = (function () { return typeof K; })(); } return [typeof K.s, K.t]; } catch (error) { return error.constructor.name; }`);
  return () => outer();
})());

show("the variable changes between the reads", (() => {
  const [read, write] = make([], "let n = 0; return [function () { return n; }, function (v) { n = v; }];")();
  return turn => { const before = read(); write(turn * 3); return [before, read()]; };
})());

show("the variable holds undefined, null, zero, the empty string, NaN", (() => {
  const inner = make(["a", "b", "c", "d", "e"], "return function () { return [a === undefined, b, c, d, e !== e]; };")(undefined, null, 0, "", NaN);
  return () => inner();
})());

show("a closure variable is called: sloppy callee", (() => {
  const inner = make(["callee"], "return function () { return callee(); };")(function () { return this === globalThis; });
  return () => inner();
})());

show("a closure variable is called: strict callee", (() => {
  const inner = make(["callee"], "return function () { return callee(); };")(function () { "use strict"; return this === undefined; });
  return () => inner();
})());

show("a closure variable is called with arguments that read others", (() => {
  const inner = make(["f", "a", "b"], "return function (x) { return f(a, b, x, a); };")((...all) => all.join(), 1, 2);
  return turn => inner(turn);
})());

show("a closure variable is constructed", (() => {
  const inner = make(["K"], "return function (x) { return new K(x).x; };")(class { constructor(x) { this.x = x; } });
  return turn => inner(turn);
})());

show("behind with", (() => {
  const inner = make(["a", "scope"], "with (scope) { return function () { return [a, b]; }; }")(1, { b: 2 });
  return () => inner();
})());

show("with hides the variable later", (() => {
  const scope = {};
  const inner = make(["a", "scope"], "with (scope) { return function () { return a; }; }")(1, scope);
  return turn => { if (turn === 2) scope.a = "hidden"; return inner(); };
})());

show("a sloppy eval declares the name later", (() => {
  const inner = make(["a"], "return function (text) { eval(text); return (function () { return a; })(); };")(1);
  return turn => inner(turn === 2 ? "var a = 'declared'" : "");
})());

show("the same text, other variables", (() => {
  const outer = make(["a"], "return function () { return a; };");
  const list = [outer(1), outer("two"), outer(null), outer({ three: 3 })];
  return () => list.map(f => f());
})());

show("forty variables", (() => {
  const names = Array.from({ length: 40 }, (_, i) => "v" + i);
  const inner = make(names, "return function () { return " + names.join(" + ") + "; };")(...names.map((_, i) => i));
  return () => inner();
})());

show("three hundred variables and as many temporaries", (() => {
  const names = Array.from({ length: 300 }, (_, i) => "v" + i);
  const text = names.map((n, i) => `let ${n} = ${i};`).join("") + "return function () { return [" + names.join() + "].reduce((a, b) => a + b, 0) + f(" + names.join() + "); }; function f() { return arguments.length; }";
  const inner = make([], text)();
  return () => inner();
})());

show("an arrow function reads this, arguments and a variable of the function around it", (() => {
  const inner = make(["a"], "return function (x) { return (() => [this.tag, arguments.length, a, x])(); };")(1);
  return turn => inner.call({ tag: "t" }, turn, 0);
})());

show("a generator and an async function", (() => {
  const [generator, later] = make(["a"], "return [function* () { yield a; yield a + 1; }, async function () { return a; }];")(5);
  return () => [[...generator()], typeof later().then];
})());

show("a default value of a parameter reads a variable", (() => {
  const inner = make(["a"], "return function (x = a, y = x + a) { return [x, y]; };")(4);
  return turn => inner(turn & 1 ? turn : undefined);
})());

show("a catch variable and a function name", (() => {
  const inner = make([], "try { throw 9; } catch (caught) { return function named(x) { return [caught, typeof named, x]; }; }")();
  return turn => inner(turn);
})());

show("a jump lands between the two halves of a read", (() => {
  const inner = make(["a", "b"], "return function (x) { let r = 0; for (let i = 0; i < 3; i++) { r += x & 1 ? a : b; if (i === 1) continue; r += a; } return r; };")(1, 10);
  return turn => inner(turn);
})());

show("the variable is a compiled closure, an object of compiled code, an array", (() => {
  const inner = make(["f", "o", "l"], "return function (x) { return [f(x), o.value, l.length]; };")(x => x + 1, { value: "v", issues: [] }, [1, 2, 3]);
  return turn => inner(turn);
})());

console.log(lines.join("\n"));
