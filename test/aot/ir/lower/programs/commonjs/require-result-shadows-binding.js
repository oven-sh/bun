// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.js
// `const m = require(..)` in a block, inside the scope of another binding named `m`.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
row("const around const", () => { const m = { x: "outer" }; const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("const around let", () => { const m = { x: "outer" }; const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("const around a pattern", () => { const m = { x: "outer" }; const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("const around a shorthand pattern", () => { const m = { x: "outer" }; const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("let around const", () => { let m = { x: "outer" }; const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("let around let", () => { let m = { x: "outer" }; const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("let around a pattern", () => { let m = { x: "outer" }; const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("let around a shorthand pattern", () => { let m = { x: "outer" }; const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("var around const", () => { var m = { x: "outer" }; const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("var around let", () => { var m = { x: "outer" }; const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("var around a pattern", () => { var m = { x: "outer" }; const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("var around a shorthand pattern", () => { var m = { x: "outer" }; const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a parameter around const", () => ((m) => { const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ x: "outer" }));
row("a parameter around let", () => ((m) => { const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ x: "outer" }));
row("a parameter around a pattern", () => ((m) => { const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ x: "outer" }));
row("a parameter around a shorthand pattern", () => ((m) => { const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ x: "outer" }));
row("a parameter of a function around const", () => (function (m) { const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ x: "outer" }));
row("a parameter of a function around let", () => (function (m) { const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ x: "outer" }));
row("a parameter of a function around a pattern", () => (function (m) { const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ x: "outer" }));
row("a parameter of a function around a shorthand pattern", () => (function (m) { const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ x: "outer" }));
row("a parameter in a pattern around const", () => (({ m }) => { const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ m: { x: "outer" } }));
row("a parameter in a pattern around let", () => (({ m }) => { const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ m: { x: "outer" } }));
row("a parameter in a pattern around a pattern", () => (({ m }) => { const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ m: { x: "outer" } }));
row("a parameter in a pattern around a shorthand pattern", () => (({ m }) => { const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); })({ m: { x: "outer" } }));
row("a function around const", () => { function m() {} m.x = "outer"; const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a function around let", () => { function m() {} m.x = "outer"; const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a function around a pattern", () => { function m() {} m.x = "outer"; const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a function around a shorthand pattern", () => { function m() {} m.x = "outer"; const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a class around const", () => { class m { static x = "outer"; } const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a class around let", () => { class m { static x = "outer"; } const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a class around a pattern", () => { class m { static x = "outer"; } const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a class around a shorthand pattern", () => { class m { static x = "outer"; } const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("the name of a function expression around const", () => { const g = function m() { const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); }; g.x = "outer"; return g(); });
row("the name of a function expression around let", () => { const g = function m() { const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); }; g.x = "outer"; return g(); });
row("the name of a function expression around a pattern", () => { const g = function m() { const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); }; g.x = "outer"; return g(); });
row("the name of a function expression around a shorthand pattern", () => { const g = function m() { const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); }; g.x = "outer"; return g(); });
row("a catch parameter around const", () => { try { throw { x: "outer" }; } catch (m) { const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("a catch parameter around let", () => { try { throw { x: "outer" }; } catch (m) { const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("a catch parameter around a pattern", () => { try { throw { x: "outer" }; } catch (m) { const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("a catch parameter around a shorthand pattern", () => { try { throw { x: "outer" }; } catch (m) { const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("the head of a for around const", () => { for (let m = { x: "outer" }, once = true; once; once = false) { const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("the head of a for around let", () => { for (let m = { x: "outer" }, once = true; once; once = false) { const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("the head of a for around a pattern", () => { for (let m = { x: "outer" }, once = true; once; once = false) { const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("the head of a for around a shorthand pattern", () => { for (let m = { x: "outer" }, once = true; once; once = false) { const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("the head of a for-of around const", () => { for (const m of [{ x: "outer" }]) { const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("the head of a for-of around let", () => { for (const m of [{ x: "outer" }]) { const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("the head of a for-of around a pattern", () => { for (const m of [{ x: "outer" }]) { const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("the head of a for-of around a shorthand pattern", () => { for (const m of [{ x: "outer" }]) { const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } });
row("a let of a block between around const", () => { { let m = { x: "outer" }; { const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("a let of a block between around let", () => { { let m = { x: "outer" }; { const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("a let of a block between around a pattern", () => { { let m = { x: "outer" }; { const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("a let of a block between around a shorthand pattern", () => { { let m = { x: "outer" }; { const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("a let of a switch around const", () => { switch (1) { case 1: let m = { x: "outer" }; { const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("a let of a switch around let", () => { switch (1) { case 1: let m = { x: "outer" }; { const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("a let of a switch around a pattern", () => { switch (1) { case 1: let m = { x: "outer" }; { const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("a let of a switch around a shorthand pattern", () => { switch (1) { case 1: let m = { x: "outer" }; { const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("another require around const", () => { const m = require("./files/b"); const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("another require around let", () => { const m = require("./files/b"); const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("another require around a pattern", () => { const m = require("./files/b"); const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("another require around a shorthand pattern", () => { const m = require("./files/b"); const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("another require in a block between around const", () => { { const m = require("./files/b"); { const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("another require in a block between around let", () => { { const m = require("./files/b"); { const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("another require in a block between around a pattern", () => { { const m = require("./files/b"); { const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("another require in a block between around a shorthand pattern", () => { { const m = require("./files/b"); { const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); } } });
row("a var that is a require around const", () => { var m = require("./files/b"); const ahead = m.x; let inside, f; { const m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a var that is a require around let", () => { var m = require("./files/b"); const ahead = m.x; let inside, f; { let m = require("./files/a"); inside = m.x; f = () => m.x; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a var that is a require around a pattern", () => { var m = require("./files/b"); const ahead = m.x; let inside, f; { const { x: m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });
row("a var that is a require around a shorthand pattern", () => { var m = require("./files/b"); const ahead = m.x; let inside, f; { const { m } = require("./files/a"); inside = m; f = () => m; } return [ahead, inside, m.x, f(), (() => m.x)()].join(); });

// FILE: files/a.js
exports.x = "a";
exports.m = "a.m";

// FILE: files/b.js
exports.x = "b";
exports.m = "b.m";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: said row
// CHECK-LABEL: function {{*}}name="said"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = String string="threw "
// CHECK-NEXT: v7 = PropGet v5 key="name"
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string=": "
// CHECK-NEXT: v9 = Add v1, v8
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v11 = Call v10, -, v2 calleeName="said"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Call v7, v5, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
