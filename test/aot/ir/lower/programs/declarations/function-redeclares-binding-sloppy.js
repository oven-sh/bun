// RUN: lower
// OPTIONS: builtin-modules

// A function declaration with the same name as a parameter, a `var`, another function or `arguments`, in sloppy code. Plain Bun's transpiler declares no `var` for a function in a block (the row "in a block, sloppy, no parameter"), and plain Bun leaves the argument in `arguments[0]` where a function is declared over the parameter (the row "arguments shows it, strict": the directive of a function has no effect in a sloppy file, so `arguments` is mapped). In both rows the expected output follows ECMAScript.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
module.exports = {};
row("control: which mode this file is in", () => (function () { return this === undefined ? "strict" : "sloppy"; })());
// 1. over a parameter
row("the row itself", () => { function o(p) { let k = "late"; function p() { return k; } return p(); } return o(1); });
row("a const", () => { function o(p) { const k = "late"; function p() { return k; } return p(); } return o(1); });
row("a class", () => { function o(p) { class K { static x = "late"; } function p() { return K.x; } return p(); } return o(1); });
row("a var", () => { function o(p) { var k = "late"; function p() { return k; } return p(); } return o(1); });
row("called ahead of the let", () => { function o(p) { const early = said(p); let k = "late"; function p() { return k; } return early + " " + p(); } return o(1); });
row("called ahead of the var", () => { function o(p) { const early = said(p); var k = "late"; function p() { return k; } return early + " " + p(); } return o(1); });
row("the let stored to later", () => { function o(p) { let k = "first"; function p() { return k; } const a = p(); k = "second"; return a + p(); } return o(1); });
row("the function stores to the let", () => { function o(p) { let k = 0; function p() { return ++k; } p(); p(); return k; } return o(1); });
row("returned and called later", () => { function o(p) { let k = "late"; function p() { return k; } return p; } return o(1)(); });
row("two activations", () => { function o(p, v) { let k = v; function p() { return k; } return p; } const a = o(1, "a"), b = o(1, "b"); return a() + b() + a(); });
row("another parameter", () => { function o(p, q) { function p() { return q; } return p(); } return o(1, "q"); });
row("another parameter, stored to", () => { function o(p, q) { function p() { return q; } q = "set"; return p(); } return o(1, "q"); });
row("itself by name", () => { function o(p) { let n = 3; function p() { return n-- > 0 ? "x" + p() : ""; } return p(); } return o(1); });
row("the parameter stored to later", () => { function o(p) { let k = "late"; function p() { return k; } const f = p; p = 7; return f() + p; } return o(1); });
row("two functions over one parameter", () => { function o(p) { let k = "late"; function p() { return "first " + k; } function p() { return "second " + k; } return p(); } return o(1); });
row("a parameter in an object pattern", () => { function o({ p }) { let k = "late"; function p() { return k; } return p(); } return o({ p: 1 }); });
row("a parameter in an array pattern", () => { function o([p]) { let k = "late"; function p() { return k; } return p(); } return o([1]); });
row("a rest parameter", () => { function o(...p) { let k = "late"; function p() { return k; } return p(); } return o(1); });
row("a parameter with a default", () => { function o(p = 1) { let k = "late"; function p() { return k; } return p(); } return o(); });
row("an arrow in it", () => { function o(p) { let k = "late"; function p() { return (() => k)(); } return p(); } return o(1); });
row("a function in it", () => { function o(p) { let k = "late"; function p() { function q() { return k; } return q(); } return p(); } return o(1); });
row("arguments shows it, strict", () => { function o(p) { "use strict"; let k = "late"; function p() { return k; } return typeof arguments[0]; } return o(1); });
row("strict", () => { function o(p) { "use strict"; let k = "late"; function p() { return k; } return p(); } return o(1); });
row("a method", () => ({ o(p) { let k = "late"; function p() { return k; } return p(); } }).o(1));
row("a generator around", () => { function* o(p) { let k = "late"; function p() { return k; } yield p(); } return [...o(1)].join(); });
row("a generator over the parameter", () => { function o(p) { let k = "late"; function* p() { yield k; } return [...p()].join(); } return o(1); });
row("a let of a loop", () => { function o(p) { const r = []; for (let i = 0; i < 2; i++) r.push(() => i); let k = r; function p() { return k.map((f) => f()).join(); } return p(); } return o(1); });
row("this of the outer by an arrow", () => { function o(p) { const self = () => this.x; function p() { return self(); } return p(); } return o.call({ x: "this" }, 1); });
// 2. over a var
row("over a var with a value", () => { function o() { var p = 1; let k = "late"; function p() { return k; } return typeof p; } return o(); });
// 3. over another function
row("over another function", () => { function o() { let k = "late"; function p() { return "first " + k; } function p() { return "second " + k; } return p(); } return o(); });
row("over another function, other captures", () => { function o() { let a = "a", b = "b"; function p() { return a; } function p() { return b; } return p(); } return o(); });
row("over another function, called ahead", () => { function o() { const early = said(p); let k = "late"; function p() { return 1; } function p() { return k; } return early + " " + p(); } return o(); });
// 4. in a block
row("in a block, sloppy, over a parameter", () => { function o(p) { let k = "late"; { function p() { return k; } } return typeof p; } return o(1); });
row("in a block, sloppy, read in it", () => { function o(p) { let k = "late"; { function p() { return k; } return p(); } } return o(1); });
row("in a block, sloppy, no parameter", () => { function o() { const early = typeof p; let k = "late"; { function p() { return k; } } return early + " " + p(); } return o(); });
row("in a block, sloppy, called ahead in the block", () => { function o() { { const early = said(p); let k = "late"; function p() { return k; } return early + " " + p(); } } return o(); });
row("in a block, strict", () => { function o(p) { "use strict"; let k = "late"; { function p() { return k; } k += p(); } return typeof p + " " + k; } return o(1); });
row("in an if, sloppy", () => { function o(p) { let k = "late"; if (p) { function p() { return k; } } return typeof p; } return o(1); });
row("in a block, over a let of the function", () => { function o() { let p = 1, k = "late"; { function p() { return k; } k += p(); } return p + " " + k; } return o(); });
// 5. over `arguments`
// 6. in a default's scope
row("a default's closure sees the parameter", () => { function o(p, q = () => p) { let k = "late"; function p() { return k; } return q() + " " + p(); } return o("argument"); });
row("a default's closure stores to the parameter", () => { function o(p, q = () => { p = "set"; }) { let k = "late"; function p() { return k; } q(); return p(); } return o("argument"); });
row("a default reads the parameter", () => { function o(p, q = p) { let k = "late"; function p() { return k; } return q + " " + p(); } return o("argument"); });
row("a default calls the parameter", () => { function o(p, q = p()) { let k = "late"; function p() { return k; } return q + " " + p(); } return o(() => "the argument's"); });
row("a function in a default of the name", () => { function o(p = function p() { return "default's"; }) { let k = "late"; function p() { return k; } return p(); } return o(); });
row("a default's closure, no function over it", () => { function o(p, q = () => p) { var p; return q() + " " + p; } return o("argument"); });
row("a default's closure, a var over it with a value", () => { function o(p, q = () => p) { var p = "var"; return q() + " " + p; } return o("argument"); });

// GENERATED: said row K self
// CHECK-LABEL: function {{*}}name="said"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b8():
// CHECK-NEXT: v1 = Call v0 calleeName="f"
// CHECK-NEXT: v2 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v2 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v3) handler=b8():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v4 = String string="F"
// CHECK-NEXT: Jump -> next b7(v4)
// CHECK-NEXT: b5(v5) handler=b8():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b8():
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = Call v6, -, v5 calleeName="String"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v8)
// CHECK-NEXT: b7(v9) handler=b8():
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b8() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = String string="threw "
// CHECK-NEXT: v13 = PropGet v11 key="name"
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v15
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
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="self"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=[[L_3]] flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="x"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
