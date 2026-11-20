// Stacks, names and messages of what the evaluated functions throw.
const show = e => console.log(String(e.stack).split("\n").slice(0, 4).map(l => l.replace(/\(?(file:\/\/)?[^ (]*\/(a04-stacks)/, "($1$2")).join(" | "));
const attempt = f => { try { console.log("gives", f()); } catch (e) { show(e); console.log(e.line, e.column, String(e.sourceURL).replace(/.*\//, "")); } };
function make(x) {
  return [
    eval("(function one() { throw new Error('one'); })"),
    eval("\n\n  (function two(a) {\n    return a.b.c;\n  })"),
    eval("(function three() {\n\n return missing + 1; })"),
    eval("(function four(f) { var g = 1;\n return f(g, () => g()); })"),
    eval("(function five(o) {\n o.method(1);\n})"),
    eval("(function six(o) {\n  return o[0][1];\n})"),
    eval("(function seven() {\n  const k = 1; k = 2;\n})"),
    eval("(function eight(v) {\n  for (const x of v) return x;\n})"),
    eval("(function nine({ a }) { return a; })"),
    eval("(function ten(C) { return new C(1);\n})"),
    eval("(function eleven(a) { return 'é€😀' + a.b.c; })"),
    eval("(function twelve(o) { return o\n  .first()\n  .second(); })"),
    eval("(function thirteen(a) { a.b.c = 1; })"),
    eval("(function fourteen(a) { return [...a]; })"),
    eval("(function fifteen(a) { throw a; })"),
    eval("(function sixteen(a) { return a instanceof 1; })"),
    eval("(function seventeen(a) { return 'x' in a; })"),
    eval("(function eighteen(a) { return a() + 1; })"),
    eval("(function nineteen(a) { let b = b + 1; return b; })"),
    eval("(function twenty(a) { return a`t`; })"),
    eval("(function twentyOne(a) { return new a; })"),
    eval("(function twentyTwo(a) { return (a.b)(1); })"),
    eval("(function twentyThree(a) { return a?.b.c.d; })"),
    eval("(function twentyFour(a) { return Symbol() + a; })"),
  ];
}
const f = make(1);
attempt(() => f[0]());
attempt(() => f[1]({}));
attempt(() => f[2]());
attempt(() => f[3](1));
attempt(() => f[3]((a, b) => b()));
attempt(() => f[4]({}));
attempt(() => f[4]({ method() { throw new TypeError("m"); } }));
attempt(() => f[5]([]));
attempt(() => f[6]());
attempt(() => f[7](1));
attempt(() => f[9](1));
attempt(() => f[9](class { constructor() { throw new Error("c"); } }));
attempt(() => f[10]({}));
attempt(() => f[11]({ first() { return {}; } }));
attempt(() => f[12]({}));
attempt(() => f[13](1));
attempt(() => f[14](new Error("given")));
attempt(() => f[15]({}));
attempt(() => f[16](1));
attempt(() => f[17]({}));
attempt(() => f[18]());
attempt(() => f[19](1));
attempt(() => f[20](1));
attempt(() => f[21]({}));
attempt(() => f[22]({ b: {} }));
attempt(() => f[23](1));
Error.prepareStackTrace = (e, s) => s.slice(0, 2).map(c => [String(c.getFileName()).replace(/.*\//, ""), c.getLineNumber(), c.getColumnNumber(), c.getFunctionName(), c.isEval(), String(c)].join("|").replace(/[^ (|]*\/(a04-stacks)/, "$1")).join("\n");
for (const g of f.slice(0, 3)) try { g({}); } catch (e) { console.log(e.stack); }
