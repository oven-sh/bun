// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.js
// `const m = require(..)` at the top level of a module is read before and after the declaration has run.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
const lines = [];
function viaFunction() { return m.x; }
lines.push("ahead of everything: " + said(() => m.x) + " " + said(viaFunction));
{ const m = require("./files/a"); lines.push("the first block: " + m.x); }
lines.push("between: " + said(() => m.x) + " " + said(viaFunction) + " " + said(() => typeof m));
const m = require("./files/b");
lines.push("behind the declaration: " + m.x + " " + viaFunction());
{ const m = require("./files/a"); lines.push("a block behind: " + m.x); { const m = { x: "innermost" }; lines.push("a let in it: " + m.x); } lines.push("the block again: " + m.x); }
lines.push("behind that: " + m.x);
lines.push("from an arrow with a block: " + (() => { { const m = require("./files/a"); } return m.x; })());
lines.push("from a function with a parameter: " + (function (m) { { const m = require("./files/a"); } return m; })("parameter"));
lines.push("identity: " + ((() => { { const m = require("./files/a"); } return m; })() === require("./files/b")));
if (m) { const m = require("./files/a"); lines.push("in an if: " + m.x); }
for (const m of [require("./files/a")]) lines.push("in a for-of: " + m.x);
try { throw 0; } catch { const m = require("./files/a"); lines.push("in a catch: " + m.x); }
lines.push("at the end: " + m.x);
{ const k = require("./files/a"); lines.push("another name, in a block: " + k.x); }
lines.push("that name outside: " + typeof k);
var v = { x: "var" };
{ const v = require("./files/a"); lines.push("a var of the file around: " + v.x); }
lines.push("the var: " + v.x);
function fn() {} fn.x = "function";
{ const fn = require("./files/a"); lines.push("a function of the file around: " + fn.x); }
lines.push("the function: " + fn.x);
class cl { static x = "class"; }
{ const cl = require("./files/a"); lines.push("a class of the file around: " + cl.x); }
lines.push("the class: " + cl.x);
let lt = { x: "let" };
{ const lt = require("./files/a"); lines.push("a let of the file around: " + lt.x); }
lines.push("the let: " + lt.x);
for (const line of lines) console.log(line);

// FILE: files/a.js
exports.x = "a";
exports.m = "a.m";

// FILE: files/b.js
exports.x = "b";
exports.m = "b.m";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: said viaFunction fn cl
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
// CHECK-LABEL: function {{*}}name="viaFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="m"
// CHECK-NEXT: v2 = PropGet v1 key="x"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="cl"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
