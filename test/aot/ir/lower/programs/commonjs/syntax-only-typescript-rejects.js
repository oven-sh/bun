// RUN: lower
// OPTIONS: builtin-modules

// Syntax that TypeScript reports and JavaScript accepts, in a CommonJS module in sloppy mode. Plain Bun declares no `var` for the labeled function, so the output is stored.
module.exports = {};
var o = { x: "a property read through with" };
with (o) { console.log(x); }
var variable = 1;
console.log(delete variable, variable);
var let = "let";
var yield = "yield";
var static = "static";
var implements = "implements";
console.log(let, yield, static, implements);
a: function f() { return "a labeled function"; }
console.log(f());
b: var c = 1;
console.log(c);
console.log({ p: 1, p: 2 }.p);
console.log({ get q() { return 1; }, q: 2 }.q);
var received;
({ set r(v = 1) { received = v; } }).r = undefined;
console.log(received);
var withoutPrototype = { __proto__: null, ["__proto__"]: 1 };
console.log(Object.getPrototypeOf(withoutPrototype), Object.keys(withoutPrototype), withoutPrototype.__proto__);
console.log(class { static constructor() { return "a static method"; } }.constructor());
console.log(new (class { m() { return 1; } m() { return 2; } })().m());
for (var [k] in { ab: 1 }) console.log(k);
for (var i = 0 in {});
console.log(i);
var tests = 0;
if (tests++);
console.log(tests);
return;
console.log("after the return");

// GENERATED: q r constructor m
// CHECK-LABEL: function {{*}}name="q"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="r"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[IsSloppy, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b5(v7):
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v8 layout=[[L_1]]
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="constructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|boolean|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="a static method"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|boolean|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
