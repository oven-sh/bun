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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: Return v3
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v4 = CatchValue
// CHECK-NEXT: v5 = String string="threw "
// CHECK-NEXT: v6 = PropGet v4 key="name"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = Call v9, -, v1 calleeName="said"
// CHECK-NEXT: v11 = Add v8, v10
// CHECK-NEXT: v12 = Call v6, v4, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="x"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=undefined|null|[[L_4]] flags=[IsExpected] variableName="m"}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
