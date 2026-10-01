// usage: node make-test-rows.cjs [/tmp/rr/parsediag-bu] > test-rows.txt
// Prints the rows of the Rust tables of B3: for each source the first parse diagnostic of typescript-go 89d5d5b
// (code, start, end, text, byte offsets), checked against tsc 6.0.2, in the shape of the tables of
// src/js_parser/parse/syntax_errors.rs: (text, loader, code, start, end, message). A source that the reference
// parses goes to the list of the group `parses`. A row whose two oracles differ is marked and must not be used.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const { spawnSync } = require("node:child_process");
const goBin = process.argv[2] || "/tmp/rr/parsediag-bu";
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const loaders = { ts: "Loader::Ts", tsx: "Loader::Tsx", js: "Loader::Js", jsx: "Loader::Jsx" };
const G = {};
const add = (g, l, ...srcs) => { (G[g] ||= []).push(...srcs.map(s => ({ l, s }))); };
// W1: an assignment operator after an expression that is no left-hand side.
add("assignment", "ts", "a + b = c;", "-a = b;", "a++ = b;", "async function f() { await x = y; }", "a + b += c;", "a * b >>>= c;", "a + b **= c;", "a + b ??= c;",
  "!a = b;", "typeof a = b;", "void a = b;", "delete a.b = c;", "++a = b;", "a || b = c;", "a ?? b = c;", "a in b = c;", "a instanceof b = c;", "a < b = c;", "a ** b = c;",
  "x = a + b = c;", "x, a + b = c;", "a = b ? c : d + e = f;", "a = b => c + d = e;", "a = /* x */ b + c = /* y */ d;", "a + b = (c);", "a + b = <T>c;", "a + b =\n  c;", "(a) + b = c;", "{ await using [a] = null; }",
  "f(a + b = c) + d = e;", "a + b = c; a++ ++;");
add("assignment", "js", "a + b = c;", "-a = b;", "a++ = b;", "async function f() { await x = y; }", "{ await using [a] = null; }");
add("assignment", "tsx", "a + b = c;");
add("assignment-in-a-slot", "ts", "(a + b = c);", "((a) + b = c);", "x = (a + b = c);", "(a + b = c) + d;", "f(a + b = c);", "f((a + b = c));", "(f(a + b = c));", "f(x, a + b = c, y);", "new F(a + b = c);", "import(a + b = c);", "f(...a + b = c);",
  "[a + b = c];", "({ k: a + b = c });", "({ [a + b = c]: 1 });", "o[a + b = c];", "o?.[a + b = c];", "`x${a + b = c}y`;", "t`x${a + b = c}y`;", "x ? a + b = c : y;", "x ? y : a + b = c;", "f(x ? y : a + b = c);",
  "x => a + b = c;", "f(x => a + b = c);", "let x = a + b = c;", "var x = () => a + b = c;", "for (let x = a + b = c;;) {}", "for (a + b = c;;) {}", "for (;a + b = c;) {}", "for (;;a + b = c) {}", "for (x of a + b = c) {}", "for (x in a + b = c) {}",
  "if (a + b = c) {}", "while (a + b = c) {}", "do {} while (a + b = c);", "switch (a + b = c) {}", "switch (x) { case a + b = c: break; }", "switch (x) { case 1: a + b = c; }", "function f() { return a + b = c; }", "throw a + b = c;",
  "export default a + b = c;", "export = a + b = c;", "enum E { A = a + b = c }", "class C { x = a + b = c; }", "class C { static x = a + b = c; }", "class C { [a + b = c]() {} }", "class C { static { a + b = c; } }",
  "function f(x = a + b = c) {}", "let [p = a + b = c] = y;", "let { p = a + b = c } = y;", "@d(a + b = c) class C {}", "namespace N { a + b = c; }", "declare namespace N { const x = a + b = c; }", "function f(a = b + c = d): void;", "declare enum E { A = a + b = c }");
add("assignment-in-a-slot", "js", "(a + b = c);", "f(a + b = c);", "with (a + b = c) {}", "class C { x = a + b = c; }");
add("assignment-in-a-slot", "tsx", "<div x={a + b = c} />;", "<div>{a + b = c}</div>;", "<div {...a + b = c} />;");
add("assignment-after-a-line-break", "ts", "a + b\n= c;", "-a\n= b;", "a++\n= b;", "a + b\n+= c;", "a + b /* c\n */ = c;", "a + b // c\n= c;", "function f() { return a + b\n= c; }", "let x = a + b\n= c;", "x => a + b\n= c;", "x ? y : a + b\n= c;",
  "switch (x) { case 1: a + b\n= c; }", "switch (x) { case 1: { a + b\n= c; } }", "class C { x = a + b\n= c; }", "(a + b\n= c);", "f(a + b\n= c);", "for (a + b\n= c;;) {}", "for (let x = a + b\n= c;;) {}", "x ? a + b\n= c : y;");
// W2, W3: an update of an update, a prefix update of what is no left-hand side.
add("update-of-an-update", "ts", "a++ ++;", "a-- --;", "a++ --;", "a++++;", "a.b++ ++;", "a[i]++ ++;", "a[i + 1]++ ++;", "f(x)++ ++;", "(a)++ ++;", "a!++ ++;", "a++ /* c */ ++;", "new A()++ ++;", "a?.b++ ++;", "this.x++ ++;",
  "a[`x${y}`]++ ++;", "a[/x]/.exec(s)]++ ++;", "a`x`++ ++;", "a++ ++ ++;", "(a++)++ ++;", "++a++;", "--a--;", "++a.b++;", "++(a)++;", "++a++ ++;", "-a++ ++;", "typeof a++ ++;", "<T>a++ ++;", "x => x++ ++;",
  "f(a++ ++);", "(a++ ++);", "[a++ ++];", "x ? a++ ++ : y;", "let x = a++ ++;", "o[a++ ++];", "`x${a++ ++}y`;", "enum E { A = a++ ++ }");
add("update-of-an-update", "js", "a++ ++;", "++a++;");
add("update-of-an-update", "tsx", "a++ ++;", "<a/>++;", "<a></a>++;", "<></>++;");
add("update-of-an-update", "jsx", "<a/>++;");
add("prefix-update", "ts", "++ delete a.b;", "++-a;", "--+a;", "++~a;", "++!a;", "++typeof a;", "--void a;", "++ ++a;", "-- --a;", "++ --a;", "++/* c */-a;", "async function f() { ++await a; }", "x = ++-a;", "f(++-a);", "(++-a);", "++-a = b;",
  "++<T>a;", "++<T>(a);", "++ <T>a;", "--<T>a.b;", "++<T>a++;");
add("type-assertion", "ts", "<T>a = c;", "<T>a += c;", "<T>(a) = c;", "<T>a\n= c;", "f(<T>a = c);", "(<T>a = c);", "-<T>a = b;", "<T>-a = b;", "<T><U>a = b;", "<T>a.b = c;", "<T>a! = c;", "<T>a++ = c;", "<T>a++.b;",
  "x as T = 1;", "a satisfies T = 1;", "a as T++;");
add("prefix-update", "js", "++ delete a.b;", "++-a;", "async function f() { ++await a; }");
add("prefix-update", "tsx", "++<a/>;");
add("prefix-update", "jsx", "++<a/>;");
// W4: a member, a call, a template or a non-null assertion after an update or after a JSX element.
add("after-an-update", "ts", "a--.b;", "a++.b;", "a++[0];", "a++(1);", "a++();", "a++`x`;", "a++`x${1}y`;", "a++?.b;", "a++?.[0];", "a++?.(1);", "a.b++.c;", "a[0]++[1];", "f()++();", "(a)++.b;", "a!++.b;", "a++ /* c */ .b;", "a++ /* c */ (1);", "a++ .b;",
  "a++.b.c;", "a++.b = 1;", "a++(1)(2);", "x = a++.b;", "new a++();", "f(a--.b);", "f(a++(1));", "(a++[0]);", "f(a++`x`);", "[a++?.b];", "x ? a--.b : y;", "let x = a--.b;", "o[a--.b];", "`x${a--.b}y`;", "class C { x = a++.b; }", "class C { x = a++[0]; }", "class C { x = a++(1); }",
  "a--\n.b;", "a--\n?.b;", "(a--\n.b);", "f(a--\n.b);", "f(a++\n(b));", "(a++\n(b));", "[a++\n[0]];", "switch (x) { case 1: a--\n.b; }", "class C { x = a--\n.b; }", "class C { x = a++\n(1); }",
  "a++!;", "a++!!;", "a++!.b;", "a++! = 1;", "(a++!);", "f(a++!);");
add("after-an-update", "js", "a--.b;", "a--.toString();", "a++[0];", "a++(1);", "a++`x`;", "a++?.b;", "a++?.(1);", "a--\n.b;", "class C { x = a++(1); }");
add("after-an-update", "tsx", "a++.b;", "<a/>.b;", "<a/>[0];", "<a/>(1);", "<a/>`x`;", "<a/>?.b;", "<a/>!;", "<a></a>.b;", "<></>.b;", "f(<a/>.b);", "x = <a/>.b;", "typeof <a/>.b;", "<a>{<b/>.c}</a>;", "<a/>\n.b;");
add("after-an-update", "jsx", "<a/>.b;", "<a/>(1);");
// S1: yield* without an operand.
add("yield-star", "ts", "function* g() { yield*; }", "function* g() { yield* }", "function* g() { (yield*); }", "function* g() { [yield*]; }", "function* g() { f(yield*, 1); }", "function* g() { x ? yield* : 1; }", "function* g() { yield* /* c */ ; }",
  "function* g() { yield * ; }", "function* g() { x = yield*; }", "function* g() { yield*\n; }", "function* g() { `${yield*}`; }", "async function* g() { yield*; }", "class C { *m() { yield*; } }", "({ *m() { yield*; } });",
  "function* g() { yield\n* x; }", "function* g() { 1 + yield x; }", "function* g() { -yield x; }", "function* g() { x || yield y; }");
add("yield-star", "js", "function* g() { yield*; }", "function* g() { (yield*); }");
// W5, S6: a name after a dot and a line break, before a word on its line.
add("name-after-a-line-break", "ts", "a.\nb in c;", "a.\nb instanceof c;", "a.\nb as c;", "a.\nb satisfies c;", "for (a.\nb of c) {}", "for (a.\nb in c) {}", "a?.\nb in c;", "a.b.\nc in d;", "x = a.\nb in c;", "f(a.\nb in c);", "(a.\nb in c);",
  "a. // x\nb in c;", "a. /* x\n */ b in c;", "a./* x */\nb in c;", "a.\n/* x */ b in c;", "a\n.\nb in c;", "a .\n b  in c;", "a.\r\nb in c;", "a.\u2028b in c;", "a.\nb /* x */ in c;", "a.\nin in c;", "a.\nb.\nc in d;", "a.\nb in\nc;",
  "-a.\nb in c;", "x + a.\nb in c;", "typeof a.\nb in c;", "new a.\nb in c;", "class C { #b; m(a) { a.\n#b in c; } }", "class C { #b; m(a) { a?.\n#b in c; } }", "class C extends a.\nb implements I {}", "@a.\nb class C {}", "class C { @a.\nb m() {} }", "class C { @a.\nb static m() {} }",
  "class C extends B { m() { super.\nb in c; } }", "import.meta.\nb in c;", "new.target.\nb in c;", "this.\nb in c;", "a.\nb in c + d = e;",
  "let x: A.\nB extends C ? D : E;", "type T = A.\nB extends C ? D : E;", "let x = y as A.\nB as C;", "let x: typeof a.\nb extends C ? D : E;", "type T = { [K in A.\nB as C]: D };", "interface I extends A.\nB extends C {}");
add("name-after-a-line-break", "js", "a.\nb in c;", "a.\nb instanceof c;", "for (a.\nb of c) {}", "a?.\nb in c;");
add("name-after-a-line-break", "tsx", "<a.\nb c='1' />;", "<a.b.\nc d='1' />;");
add("name-after-a-line-break", "jsx", "<a.\nb c='1' />;");
// What the reference parses.
add("parses", "ts", "(a + b) = c;", "a! = c;", "a!! = 1;", "(x as T) = 1;", "(<T>x) = 1;", "(a ? b : c) = d;", "a ? b : c = d;", "a = b = c;", "a, b = c;", "a = b => c = d;", "1 = 2;", "this = 1;", "f() = 1;", "a?.b = 1;", "new X = 1;", "import.meta = 1;", "`a` = 1;", "a<b> = c;", "using [a] = null;",
  "(a++)++;", "++(a++);", "(a++).b;", "(a++)[0];", "(a++)(1);", "(a++)`x`;", "(a++)!;", "(a++)! = 1;", "(a++)<T>(x);", "a++ as T;", "(a++ as T).b;", "a++ + b;", "a++ ** 2;", "- -a++;", "a++\n++b;", "a++\n!b;", "new a++;", "a?.b++;", "a! ++;",
  "a++<T>(x);", "a++<T>x;", "a++\n<T>(x);", "f(a++<T>(x));", "a--<T, U>(x);", "a++<T>`x`;", "a++ <T>(x) > y;",
  "++(delete a.b);", "++(-a);", "++a.b;", "++new A;", "++a();", "++a!;", "++(a);", "++a<T>;", "++this;", "++1;", "++'x';", "++[a];", "++{}.x;", "++function(){};", "++class{};", "++import.meta;", "++new.target;", "++a?.b;", "++`x`;", "<T>a++;", "<T>++a;", "-<T>a;",
  "a.\nb\nin c;", "a.\nb.c in d;", "a.\nb(c) in d;", "a.\nb[c] in d;", "a.\nb = c;", "a.\nb;", "a.\nb + c;", "a\n.b in c;", "a.\nb /* x\n */ in c;", "a.\nb! in c;", "a.\nb++ in c;", "a.\nb<T> in c;", "a.\nb\n.c in d;", "(a.\nb) in c;", "a.\nb ? c : d;", "class C extends a.\nb {}", "class C { @a.\nb\nm() {} }",
  "let x: A.\nB;", "let x: A.\nB = c;", "let x: A.\nB | C;", "import a = b.\nc;",
  "function* g() { yield*\nx; }", "function* g() { yield; yield\nx; (yield); [yield]; f(yield, 1); x ? yield : 1; }", "function* g() { yield* x; yield *x; yield\n; }", "function* g() { x ? yield y : z; }", "function* g() { x = yield y; }", "function* g() { f(yield y); }");
add("parses", "js", "(a + b) = c;", "1 = 2;", "f() = 1;", "(a++).b;", "a++<b>(c);", "a.\nb\nin c;");
add("parses", "tsx", "(<a/>).b;", "<a/> = 1;", "(<a/>)++;", "++(<a/>);", "<a/> as T;", "<a/> + 1;", "<a/> ? 1 : 2;", "-<a/>;", "<a.\nb/>;", "<a.\nb></a.b>;", "<a.\nb {...c} />;", "<a.\nb\nc='1' />;", "<a><b/>.c</a>;", "a++<T>(x);");
// What the reference parses and Bun's parse pass reads another way, in every mode.
add("the-reference-inserts-a-semicolon", "ts", "a++\n(b);", "a++\n[0];", "a++\n`x`;", "x = a++\n(b);", "let x = a++\n(b);", "function f() { return a++\n(b); }", "a++ /* c\n */ (b);", "a++ // c\n(b);", "a++\n(b).c(d) + e;", "class C { x = a++\n[0]; }");
add("the-reference-inserts-a-semicolon", "js", "a++\n(b);", "a++\n[0];", "a++\n`x`;");
add("the-reference-inserts-a-semicolon", "tsx", "<a/>\n(1);", "<a/>\n[0];");
const all = [];
for (const [g, rows] of Object.entries(G)) for (const r of rows) all.push({ g, ...r });
const input = all.map((r, id) => JSON.stringify({ id, name: "input." + r.l, src: r.s })).join("\n") + "\n";
const p = spawnSync(goBin, [], { input, maxBuffer: 1 << 28 });
const go = new Map();
for (const line of String(p.stdout).split("\n")) if (line) { const r = JSON.parse(line); go.set(r.id, r); }
const rust = s => 'b"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\u2028/g, "\\xe2\\x80\\xa8") + '"';
let group = null, differ = 0, count = 0;
all.forEach((r, id) => {
  if (r.g !== group) { group = r.g; console.log("// " + group); }
  const g = go.get(id);
  const sf = ts.createSourceFile("input." + r.l, r.s, ts.ScriptTarget.Latest, false, kinds[r.l]);
  const t = sf.parseDiagnostics[0];
  const d = (g.diags || [])[0];
  const toByte = u16 => Buffer.byteLength(r.s.slice(0, u16));
  const tsc = t ? [t.code, toByte(t.start), toByte(t.start + t.length), ts.flattenDiagnosticMessageText(t.messageText, "\n")] : null;
  const ref = d ? [d[0], d[1], d[1] + d[2], d[5]] : null;
  const same = JSON.stringify(tsc) === JSON.stringify(ref);
  if (!same) differ++;
  count++;
  const mark = same ? "" : "  // THE TWO ORACLES DIFFER: tsc " + JSON.stringify(tsc);
  if (!ref) console.log(`    (${rust(r.s)}, ${loaders[r.l]}),${mark}`);
  else console.log(`    (${rust(r.s)}, ${loaders[r.l]}, ${ref[0]}, ${ref[1]}, ${ref[2]}, ${JSON.stringify(ref[3])}),${mark}`);
});
console.error(`${count} rows, ${differ} where tsc 6.0.2 and typescript-go differ`);
