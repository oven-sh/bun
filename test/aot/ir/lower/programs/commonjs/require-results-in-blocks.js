// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.js
// `const m = require(..)` of different modules in sibling and nested blocks under the same name.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
row("sibling blocks", () => { let r = []; { const m = require("./files/a"); r.push(m.x); } { const m = require("./files/b"); r.push(m.x); } return r.join(); });
row("sibling blocks, the other order", () => { let r = []; { const m = require("./files/b"); r.push(m.x); } { const m = require("./files/a"); r.push(m.x); } return r.join(); });
row("nested blocks", () => { let r = []; { const m = require("./files/a"); r.push(m.x); { const m = require("./files/b"); r.push(m.x); } r.push(m.x); } return r.join(); });
row("three deep", () => { let r = []; { const m = require("./files/a"); { const m = require("./files/b"); { const m = require("./files/a"); r.push(m.x); } r.push(m.x); } r.push(m.x); } return r.join(); });
row("the same module twice", () => { let r = []; { const m = require("./files/a"); r.push(m.x); } { const m = require("./files/a"); r.push(m.x); } return r.join(); });
row("a block, then the function's own", () => { let r = []; { const m = require("./files/a"); r.push(m.x); } const m = require("./files/b"); r.push(m.x); return r.join(); });
row("the function's own, then a block", () => { let r = []; const m = require("./files/b"); r.push(m.x); { const m = require("./files/a"); r.push(m.x); } r.push(m.x); return r.join(); });
row("two functions", () => { const f = () => { const m = require("./files/a"); return m.x; }, g = () => { const m = require("./files/b"); return m.x; }; return f() + g() + f(); });
row("a function in a block of a function", () => { const m = require("./files/b"); { const m = require("./files/a"); return (() => { { const m = require("./files/b"); } return m.x; })(); } });
row("closures of both", () => { let f, g; { const m = require("./files/a"); f = () => m; } { const m = require("./files/b"); g = () => m; } return [f().x, g().x, f() === require("./files/a"), g() === require("./files/b"), f() === g()].join(); });
row("in both arms of an if", () => [1, 0].map((c) => { if (c) { const m = require("./files/a"); return m.x; } else { const m = require("./files/b"); return m.x; } }).join());
row("in two cases of a switch, each in a block", () => [1, 2].map((c) => { switch (c) { case 1: { const m = require("./files/a"); return m.x; } case 2: { const m = require("./files/b"); return m.x; } } }).join());
row("in try, catch and finally", () => { let r = []; try { const m = require("./files/a"); r.push(m.x); throw 0; } catch { const m = require("./files/b"); r.push(m.x); } finally { const m = require("./files/a"); r.push(m.x); } return r.join(); });

// FILE: files/a.js
exports.x = "a";
exports.m = "a.m";

// FILE: files/b.js
exports.x = "b";
exports.m = "b.m";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: said row f
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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|string, v2: undefined|null|function):
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
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=undefined|null|"a" flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = Convert v1 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="x"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|"a" flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=undefined|null|[[L_5]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_5]] flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
