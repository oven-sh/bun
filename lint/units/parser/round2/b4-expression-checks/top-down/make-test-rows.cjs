// usage: node make-test-rows.cjs > test-rows.txt
// The rows of the Rust tables of B4: (text, loader, code, start, end, message) is the first parse diagnostic of typescript-go
// 89d5d5b (PARSEDIAG, default /tmp/rr/parsediag-bu); a row is marked where tsc 6.0.2 has another first diagnostic. A source
// in a group named "parses ..." has no diagnostic in either. Offsets are bytes: every source is ASCII.
const { spawnSync } = require("node:child_process");
const ts = require(process.env.TSC || "/workspace/wt/parser/node_modules/typescript");
const bin = process.env.PARSEDIAG || "/tmp/rr/parsediag-bu";
const C = body => `class C { #b = 1; m(a) { ${body} } }`;
const D = body => `class A extends B { m() { ${body} } }`;
const K = body => `class A extends B { constructor() { ${body} } }`;
const F = body => `async function f() { ${body} }`;
const both = s => [["ts", s], ["js", s]];
const tsOnly = s => [["ts", s]];
const groups = [
  ["TS17006: the operand of ** is a unary expression (error path of nine sites)", [
    ...["-x ** 2;", "+x ** 2;", "~x ** 2;", "!x ** 2;", "typeof x ** 2;", "void x ** 2;", "delete x.y ** 2;", F("await x ** 2;"), F("y = await x ** 2;"),
      "a - -x ** 2;", "2 ** -x ** 2;", "x = -y ** 2;", "f(-x ** 2);", "-x.y ** 2;", "-x() ** 2;", "-x++ ** 2;", "-x\n** 2;", "- new A() ** 2;", "-(x) ** 2;", "-x ** 2 ** 3;",
      "for (const k in -x ** 2) {}", "x ? -y ** 2 : z;", "typeof import('a') ** 2;", "-a.b.c(d)[e] ** 2;"].flatMap(both),
    ...["-x!.y ** 2;", "-(x as any) ** 2;"].flatMap(tsOnly),
  ]],
  ["TS17006: the operator before the operand is the one the reference names (Err arm of the operand of each unary site)", [
    ...["- -x ** 2;", "-+x ** 2;", "!-x ** 2;", "typeof -x ** 2;", "void typeof x ** 2;", "- - -x ** 2;", F("await -x ** 2;"), F("-await x ** 2;"), F("y = typeof await x ** 2;")].flatMap(both),
    ...["-<A>x ** 2;", "- <A>x ** 2;", "typeof <A>x ** 2;", F("await <A>x ** 2;"), "y = -<A>x ** 2;"].flatMap(tsOnly),
  ]],
  ["TS17006 and TS17007: a comment before ** or after the operator (needs the comments of the lint parse)", [
    ...["-x /*c*/ ** 2;", "- /*c*/ x ** 2;", "- (x) /*c*/ ** 2;", "- /*c*/ -x ** 2;"].flatMap(both),
    ...["<A>x /*c*/ ** 2;", "<A>x /*c*/ . y ** 2;"].flatMap(tsOnly),
  ]],
  ["TS17007: the operand of ** is a type assertion (lint twin of <T>x)", [
    ...["<A>x ** 2;", "<A>(x) ** 2;", "<A>x.y ** 2;", "<A>x++ ** 2;", "<A> x ** 2;", " <A>x ** 2;", "/*c*/ <A>x ** 2;", "y = <A>x ** 2;", "f(<A>x ** 2);", "2 ** <A>x ** 2;", "<A>x\n** 2;",
      "<A>new X ** 2;", "<A>x! ** 2;", "<A>(x)(y) ** 2;", "<A>(x).y ** 2;", "<A>(x) ** 2 ** 3;", "(<A>x ** 2);", "a > <B>x ** 2;", "<const>x ** 2;", "function* g() { yield <A>x ** 2; }",
      "x = y ? <A>z ** 2 : w;", "<A>{} ** 2;", "<A>[] ** 2;", "<A>`a` ** 2;", "<A>x?.y ** 2;", "<A>x`t` ** 2;", "<A>(<B>x ** 2);", "<A>f(<B>x ** 2);", "<A>[<B>x ** 2];"].flatMap(tsOnly),
  ]],
  ["TS17007: the outer assertion is the one the reference names (Err arm of the operand in the twin)", [
    ...["<A><B>x ** 2;", "<A>-x ** 2;", "<A>--x ** 2;", F("<A>await x ** 2;"), "<A><B><C>x ** 2;", "<A>typeof x ** 2;"].flatMap(tsOnly),
  ]],
  ["TS1477: a property access after an instantiation expression (lint_type_arguments_in_expression)", [
    ...["a<b>.c;", "a<b>?.c;", "a<b>.c<d>.e;", "a<b>.c<d>(e);", "new A<T>.b();", "new A<T>.b;", "a<b, c>.d;", "a<b> .c;", "a<b>\n.c;", "a< b /*x*/ > /*y*/ .c;", "a<b>.#c;", C("a<b>.#b;"),
      "a.b<c>.d;", "f()<b>.c;", "a?.b<c>.d;", "a<b>.c = 1;", "a<<T>(x: T) => void>.c;", "a<b<c>>.d;", "a<b<c<d>>>.e;", "x = a<b>.c;", "f(a<b>.c);", "a<>.c;", "a<b,>.c;", "this<T>.x;",
      "a!<b>.c;", "import.meta<T>.x;", "a<b>.c`x`;", "a`x`<b>.c;", "a<b>.then<c>(d);", "a<b>.class;", "a<b>?.\nc;", "async<b>.c;", "typeof a<b>.c;", "new a<b>.c();", "a<b>?.c?.d;",
      "class C extends A<T>.b {}", "class C implements A<T>.b {}", "@a<b>.c class C {}", "export default a<b>.c;", "enum E { A = a<b>.c }", "new a.b<c>.d?.e();"].flatMap(tsOnly),
  ]],
  ["TS1003 and TS18030 come first after an instantiation expression", [
    ...["a<b>.;", "a<b>?.;", "a<b>..c;", "a<b>?.#c;", C("a<b>?.#b;")].flatMap(tsOnly),
  ]],
  ["TS1011: an element access without an argument (Err arm of the two sites)", [
    ...["a[];", "a[ ];", "a[\n];", "a?.[];", "a?.[ ];", "a[][0];", "a[b[]];", "a[] = 1;", "new A[];", "new A[]();", "x = a[];", "a.b[];", "a()[];", "for (const x of y[]) {}", "a[].b;", "a[]();",
      "a[]\n[];", "f(a[]);", "[a[]];", "`${a[]}`;", "(a[]);", "a[[]][];", "let [] = a[];", "a?.b[];", "class A extends B { m() { super[]; } }", "this[];", "import.meta[];", "async[];", "of[];",
      "function* g() { (yield)[]; }", "a[b?.[]];", "a?.[b[]];", "a[(b[])];", "a[b, c[]];", "x = a\n[];", "class C { a = b\n[] }", "({ a: b[] });", "let { [a[]]: x } = y;", "if (a[]) {}",
      "(a)[];", "[][];", "x = {}[];", "'a'[];", "1[];", "`a`[];", "for (a[] of b) {}", "for (;a[];) {}"].flatMap(both),
    ...["a![];", "let x: A[] = a[];", "a[] as any;", "let x = <T>a[];", "enum E { A = a[] }", "a[]<b>;", "@(a[]) class C {}", "class C { @(a[]) m() {} }"].flatMap(tsOnly),
  ]],
  ["TS1011: a comment between the brackets (needs the comments of the lint parse)", [
    ...["a[/*c*/];", "a[ /*c*/ ];", "a[ // c\n];", "a?.[/*c*/];", "a [ /*1*/ /*2*/ ] ;"].flatMap(both),
  ]],
  ["TS1109 stays where no element access misses its argument", [
    ...["a[{ []: 1 }];", "({ []: 1 });", "a[({ [] : b }) => 0];", "a[,];", "a[", "a[;", "a[)", "a[(]", "a[in b];"].flatMap(both),
  ]],
  ["for head: using before of is a name (lint edit after the using test), and of [] is TS1011", [
    ...["for (using of of []) {}", "for (using of\nof []) {}", "for (using\nof of []) {}", "for (using of of\n[]) {}", "for (using of of [ ]) {}", "for (using of of x) {}", "for (using of in x) {}",
      "for (using of of of) {}", "for (using of, x;;) {}", "for (using of) {}", "for (using of! of []) {}", F("for await (using of of []) {}"), F("for await (using of of x) {}")].flatMap(both),
    ...["for (using of as any of []) {}"].flatMap(tsOnly),
  ]],
  ["for head: a comment before the second of (needs the comments of the lint parse)", [
    ...["for (using of /*c*/ of []) {}", "for (using of of [/*c*/]) {}"].flatMap(both),
  ]],
  ["TS2754: type arguments after super (error path of pfx_t_super, TypeScript only)", [
    ...[K("super<T>();"), K("super <T>();"), K("super /*c*/ <T> /*d*/ ();"), K("super<T, U>();"), K("super<>();"), K("super<T,>();"), K("super<T>(1).x;"), D("super<T>.x;"), D("super<T>.x();"),
      D("super<T>;"), D("super\n<T>();"), D("super<T>`x`;"), D("super < T > (x);"), D("super<A<B>>();"), D("super<T>?.x;"), D("super<T>\nx;"), D("super<T> = 1;"), D("super<T> as any;"),
      D("super<T[]>();"), D("super<{ a: 1 }>();"), D("super<A | B>();"), "super<T>();", "super<T>.x;", "function f() { super<T>(); }", "class A extends B { x = super<T>(); }"].flatMap(tsOnly),
  ]],
  ["TS1034: super before what is no argument list and no member access (error path of pfx_t_super)", [
    ...[D("super;"), D("super + 1;"), D("super`x`;"), D("return super }"), D("return super;"), D("super?.x;"), D("super?.();"), D("x = super;"), D("f(super);"), D("super = 1;"), D("super++;"),
      D("(super);"), D("typeof super;"), D("[super];"), D("`${super}`;"), D("super => 1;"), D("super ? 1 : 2;"), D("super, 1;"), D("super\n;"), D("super"), "super;", "x = super;",
      D("super in x;"), D("super instanceof A;")].flatMap(both),
    ...[D("super<T>[0];"), D("super<T }"), D("super<T;"), D("super<T>x;"), D("super<T>1;"), D("super!.x;"), D("super as any;"), D("super<T>>();"), D("super<<T>() => void>();"), D("super<T>!.x;"),
      D("super<T> + 1;"), D("super<T>++;"), D("super<T,;"), D("super<;"), D("super<T>=x;"), "super<T"].flatMap(tsOnly),
    ...[K("super<T>();"), D("super<T>.x;"), D("super <T>();")].map(s => ["js", s]),
  ]],
  ["TS1034: a comment before the token (needs the comments of the lint parse: none, the token is the one the lexer is on)", [
    ...[D("super /*c*/ ;")].flatMap(both),
  ]],
  ["TS18030: a private name after ?. (the name arm of sfx_t_question_dot; outside a class its error path)", [
    ...["a?.#b;", "this?.#a;", "a ?. #b;", C("a?.#b;"), C("a?.#b = 1;"), C("a ?. #b;"), C("a?.\n#b;"), C("a?.#b();"), C("a?.#b.#b;"), C("a.x?.#b;"), C("a?.b?.#b;"), C("a?.[0]?.#b;"), C("this?.#b;"),
      C("delete a?.#b;"), C("a?.#b`x`;"), C("a?.#b++;"), C("x = a?.#b ?? 1;"), C("a?.#c;"), C("new (a?.#b)();"), "class C { #b; [a?.#b] = 1; }"].flatMap(both),
    ...[C("a!?.#b;"), C("a<T>?.#b;")].flatMap(tsOnly),
  ]],
  ["TS18030: a private name later in an optional chain (the walk; outside a class the error path of sfx_t_dot)", [
    ...["a?.x.#b;", "a?.b.#c.d;", C("a?.x.#b;"), C("a?.[0].#b;"), C("a?.().#b;"), C("a?.x.y.#b;"), C("a?.x.y.#b.z;"), C("a?.x.y().z[0].#b;"), C("a?.b.#b = 1;"), "class C { #b; m = (a) => a?.x.#b; }"].flatMap(both),
    ...[C("a?.x!.#b;"), C("a?.x!!.#b;"), C("a?.<T>().#b;"), C("a?.b![0].#b;"), C("a?.b<T>().#b;"), C("a?.b.c!.#b;"), C("a!?.b!.#b;"), C("<any>a?.b.#b;")].flatMap(tsOnly),
  ]],
  ["TS18030: a comment before the name (needs the comments of the lint parse: none, the range is the name)", [
    ...[C("a ?. /*c*/ #b;")].flatMap(both),
  ]],
  ["TS1209: ?. before the arguments of new (the two branches of sfx_t_question_dot that end the target of new)", [
    ...["new A?.();", "new (A?.b)?.();", "new a.b?.();", "x = new A?.();", "new A?.`x`;", "new (A)?.();", "new A ?. ();", "new  a . b ?.();"].flatMap(both),
    ...["new A?.<T>();", "new A<T>?.();"].flatMap(tsOnly),
  ]],
  ["TS1209: a template after an optional chain in the target of new (error path of the two template handlers)", [
    ...["new A?.b`x`;", "new A?.b`x${1}`;", "new a.b?.c`x`;", "new A?.[0]`x`;"].flatMap(both),
  ]],
  ["TS17006: the name await before ** (the walk)", [
    ...["function f() { await ** 2; }", "function f() { return await ** 2; }", "function f(await) { return await ** 2; }", "function f() { await.x ** 2; }", "function f() { await() ** 2; }",
      "function f() { await++ ** 2; }", "function f() { x = await\n** 2; }", "function f() { y = await[0] ** 2 ** 3; }", "function f() { await`x` ** 2; }"].flatMap(both),
    ...["function f() { await! ** 2; }", "function f() { await<T>(x) ** 2; }"].flatMap(tsOnly),
  ]],
  ["TS17006: the name await before a comment and ** (needs the comments of the lint parse)", [
    ...["function f() { await /*c*/ ** 2; }"].flatMap(both),
  ]],
  ["TS1209: an optional chain in the target of new (the walk)", [
    ...["new A?.b();", "new A?.b;", "new A.B?.c();", "new (A)?.b();", "new A?.[0];", "new A?.[0]();", "new A?.b.c();", "new A?.b?.c();", "new new A?.b()();", "new A ?.b();", "new A\n?.b();",
      "new a.b.c?.d();", "new A`x`?.b();", "new this?.b();", "new class {}?.b();", "new function () {}?.b();", "new A['x']?.b();", C("new a?.#b();"), C("new a.#b?.c();"), "x = new A?.b();",
      "f(new A?.b());", "new  A . B ?.c();", "new A?.b = 1;", "new A?.b++;", "new (new A)?.b();", "new new A?.b();", "new (a, b)?.c();", "new A.b?.[c]?.d();", "new 'a'?.b();", "new 1?.b();",
      "new []?.b();", "new {}?.b();", "new /a/?.b();", "new `a`?.b();", "new async?.b();", "class X extends Y { m() { new super.x?.y(); } }", "new (a?.b)?.c();", "new a[b?.c]?.[d]();",
      "new A?.[(0)]();", "new A ?. [ 0 ]();", "x = new A?.b()?.c;", "new A?.b\n;"].flatMap(both),
    ...["new A<T>?.b();", "new A!?.b();", "new (A)!?.b();", "new A?.b<T>();", "new A <T> ?.b();", "new A!<T>?.b();", "new a.b!?.c();", "new A?.[<T>x]();"].flatMap(tsOnly),
  ]],
  ["TS1209: a comment in the target or before ?. (needs the comments of the lint parse)", [
    ...["new A /*c*/ ?.b();", "new a /*c*/ . b /*d*/ ?.c();"].flatMap(both),
  ]],
  ["parses: what the reference reads and a lint parse must read", [
    ...["(-x) ** 2;", "-(x ** 2);", "2 ** -x;", "++x ** 2;", "x++ ** 2;", "a-x ** 2;", F("(await x) ** 2;"), "new A()?.b;", "new A()?.b();", "new (A?.b)();", "new (A?.b);", "function f() { (await) ** 2; }", "function f() { (await.x) ** 2; }", "function f() { awaited ** 2; }", "function f() { a.await ** 2; }", "new A?.3:1;", "new A().b?.c();",
      "(new A)?.b();", "new (a?.b).c();", "function f() { new.target?.b(); }", "a[[]];", "a[of];", "x = a;\n[];", C("a.#b;"), C("a.#b?.c;"), C("(a?.x).#b;"),
      C("return #b in a?.x;"), C("new a.#b();"), C("(a?.b).c.#b;"), "for (using of of [1]) {}", "for (using of of) {}", "for (using of [1]) {}", "for (using of []) {}", "for (using of x) {}",
      "for (using x of y) {}", "for (using of = null;;) {}", "for (using of;;) {}", "for (using in x) {}", "for (using;;) {}", "for (using = 1;;) {}", "for (using.x of y) {}", "for (using[0] of y) {}",
      "for (using x = y;;) {}", "for (using [a] of y) {}", "for (using of of.x) {}", "for (using of of()) {}", "for (using of of?.[0]) {}", "for (using of of => of) {}", "for (using x in y) {}",
      F("for (await using of of []) {}"), F("for (await using of of x) {}"), F("for (await using x of y) {}"), F("for await (using x of y) {}"), "using of = null;", "for (of of []) {}",
      K("super();"), D("super.x;"), D("super[0];"), D("super\n.x;"), D("delete super.x;"), K("super()(); "), K("-super();"), K("super().x;")].flatMap(both),
    ...["<A>(x) => x ** 2;", "(<A>x) ** 2;", "<A>(x ** 2);", "<A>x as B ** 2;", "-x as any ** 2;", "a<b>?.[c];", "a<b>?.();", "a<b>['c'];", "(a<b>).c;", "a<b>`x`.c;", "a<b>(c).d;", "a<b>[];", "a<b>.1;",
      "a<b>?.3:1;", "class C extends A.b<T> {}", "a<b> as any;", "a<b>;", "a?.<b>().c;", C("(a?.x)!.#b;"), C("(a?.x as any).#b;"), C("(<any>a?.b).#b;"), D("super.x<T>();"), "for (using of: T = null;;) {}",
      "type T = A[ ];", "class C { a = b; [] }"].flatMap(tsOnly),
  ]],
  ["parses: super where only the checker of the reference objects (a parse without lint reports Unexpected \"super\")", [
    ...["super();", "super.x;", "super[0]();", "super.x?.y;", "class A { m() { super(); } }", "class A { constructor() { super(); } }", D("super();"), "class A extends B { static { super(); } }",
      "class A extends B { x = super(); }", "class A extends B { [super.x]() {} }", "function f() { super.x; }", "function f() { super(); }", "({ m() { super(); } });",
      "({ m: function () { super.x; } });", K("function g() { super(); }"), D("new super;"), D("new super();"), K("new super();"), "new super[0]();", D("super\n();"), D("super /*c*/ ();")].flatMap(both),
    ...[D("new super<T>();"), "new super<T>;", "new super.x<T>();"].flatMap(tsOnly),
  ]],
  ["TS1011 and TS1209 behind super where only the checker objects", [
    ...["super[];", "new super?.x();", "new super.x?.y();"].flatMap(both),
    ...["<A>super.x ** 2;"].flatMap(tsOnly),
  ]],
];
const rows = [];
for (const [group, list] of groups) for (const [loader, src] of list) rows.push({ group, loader, src });
const input = rows.map((r, id) => JSON.stringify({ id, name: "a." + r.loader, src: r.src })).join("\n") + "\n";
const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 1 << 28 });
if (run.status !== 0) throw new Error("parsediag failed: " + run.stderr);
for (const line of run.stdout.split("\n")) { if (!line) continue; const o = JSON.parse(line); rows[o.id].go = o.panic ? null : o.diags.map(d => [d[0], d[1], d[2], d[5]]); }
const kinds = { ts: ts.ScriptKind.TS, js: ts.ScriptKind.JS };
const lit = s => 'b"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
const str = s => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
let group = null, bad = 0;
const counts = {};
for (const r of rows) {
  if (r.group !== group) { group = r.group; console.log(`\n// ${group}`); }
  const sf = ts.createSourceFile("/a." + r.loader, r.src, ts.ScriptTarget.ESNext, true, kinds[r.loader]);
  const t = sf.parseDiagnostics.map(d => [d.code, d.start, d.length, ts.flattenDiagnosticMessageText(d.messageText, "\n")]);
  const loader = r.loader === "ts" ? "Loader::Ts" : "Loader::Js";
  if (!r.go) { console.log(`// PANIC of typescript-go: ${lit(r.src)}`); bad++; continue; }
  const parses = group.startsWith("parses");
  if (parses) {
    if (r.go.length || t.length) { console.log(`// NOT A ROW, the reference reports TS${(r.go[0] || t[0])[0]}: (${lit(r.src)}, ${loader}),`); bad++; continue; }
    console.log(`(${lit(r.src)}, ${loader}),`);
    counts[group] = (counts[group] ?? 0) + 1;
    continue;
  }
  if (!r.go.length) { console.log(`// NOT A ROW, the reference parses: (${lit(r.src)}, ${loader}),`); bad++; continue; }
  const [code, start, length, text] = r.go[0];
  const same = t.length && t[0][0] === code && t[0][1] === start && t[0][2] === length && t[0][3] === text;
  console.log(`(${lit(r.src)}, ${loader}, ${code}, ${start}, ${start + length}, ${str(text)}),` + (same ? "" : `  // tsc 6.0.2: ${t.length ? `TS${t[0][0]} [${t[0][1]},${t[0][1] + t[0][2]})` : "parses"}`) + (r.go.length > 1 ? `  // then TS${r.go[1][0]} [${r.go[1][1]},${r.go[1][1] + r.go[1][2]})` : ""));
  counts[group] = (counts[group] ?? 0) + 1;
}
console.error(JSON.stringify({ rows: rows.length, notRows: bad, counts }, null, 1));
